#include "http_client.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SERVICE_URL "http://127.0.0.1:8787"

// Response buffer for curl
typedef struct {
    char *data;
    size_t size;
    size_t capacity;
} ResponseBuffer;

static size_t write_callback(void *contents, size_t size, size_t nmemb, void *userp) {
    size_t realsize = size * nmemb;
    ResponseBuffer *buf = (ResponseBuffer *)userp;

    if (buf->size + realsize + 1 > buf->capacity) {
        return 0; // Buffer full
    }

    memcpy(buf->data + buf->size, contents, realsize);
    buf->size += realsize;
    buf->data[buf->size] = '\0';

    return realsize;
}

int http_get(const char *url, char *response, size_t max_len) {
    CURL *curl = curl_easy_init();
    if (!curl) return -1;

    ResponseBuffer buf = { response, 0, max_len };
    response[0] = '\0';

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 2L);

    CURLcode res = curl_easy_perform(curl);
    curl_easy_cleanup(curl);

    return (res == CURLE_OK) ? 0 : -1;
}

int http_post(const char *url, const char *body, char *response, size_t max_len) {
    CURL *curl = curl_easy_init();
    if (!curl) return -1;

    ResponseBuffer buf = { response, 0, max_len };
    response[0] = '\0';

    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body ? body : "");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 2L);

    CURLcode res = curl_easy_perform(curl);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    return (res == CURLE_OK) ? 0 : -1;
}

// Simple JSON parser helpers (minimal, no external dependency)
static const char *find_json_string(const char *json, const char *key) {
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);

    const char *p = strstr(json, search);
    if (!p) return NULL;

    p = strchr(p + strlen(search), ':');
    if (!p) return NULL;

    // Skip whitespace
    while (*p && (*p == ':' || *p == ' ' || *p == '\t')) p++;

    return p;
}

static int parse_json_string(const char *json, const char *key, char *out, size_t out_len) {
    const char *p = find_json_string(json, key);
    if (!p || *p != '"') return -1;

    p++; // Skip opening quote
    size_t i = 0;
    while (*p && *p != '"' && i < out_len - 1) {
        out[i++] = *p++;
    }
    out[i] = '\0';
    return 0;
}

static int parse_json_int(const char *json, const char *key) {
    const char *p = find_json_string(json, key);
    if (!p) return 0;
    return atoi(p);
}

static int parse_json_bool(const char *json, const char *key) {
    const char *p = find_json_string(json, key);
    if (!p) return 0;
    return (strncmp(p, "true", 4) == 0) ? 1 : 0;
}

int sync_service_get_status(SyncStatus *status) {
    char response[4096];

    memset(status, 0, sizeof(SyncStatus));

    if (http_get(SERVICE_URL "/status", response, sizeof(response)) != 0) {
        return -1;
    }

    status->running = parse_json_bool(response, "running");
    status->configured = parse_json_bool(response, "configured");
    parse_json_string(response, "watchFolder", status->watch_folder, sizeof(status->watch_folder));
    parse_json_string(response, "remoteDestination", status->remote_destination, sizeof(status->remote_destination));
    status->poll_interval_sec = parse_json_int(response, "pollIntervalSec");

    // Current upload (might be null)
    const char *cu = find_json_string(response, "currentUpload");
    if (cu && *cu == '"') {
        parse_json_string(response, "currentUpload", status->current_upload, sizeof(status->current_upload));
    }

    // Parse files object
    const char *files = strstr(response, "\"files\"");
    if (files) {
        status->total_files = parse_json_int(files, "total");
        status->pending_files = parse_json_int(files, "pending");
        status->synced_files = parse_json_int(files, "synced");
        status->error_files = parse_json_int(files, "error");
    }

    return 0;
}

int sync_service_start(void) {
    char response[256];
    return http_post(SERVICE_URL "/start", NULL, response, sizeof(response));
}

int sync_service_stop(void) {
    char response[256];
    return http_post(SERVICE_URL "/stop", NULL, response, sizeof(response));
}

int sync_service_sync_now(void) {
    char response[256];
    return http_post(SERVICE_URL "/sync-now", NULL, response, sizeof(response));
}

int sync_service_get_config(SyncConfig *config) {
    char response[4096];

    memset(config, 0, sizeof(SyncConfig));

    if (http_get(SERVICE_URL "/config", response, sizeof(response)) != 0) {
        return -1;
    }

    parse_json_string(response, "serverUrl", config->server_url, sizeof(config->server_url));
    parse_json_string(response, "username", config->username, sizeof(config->username));
    parse_json_string(response, "password", config->password, sizeof(config->password));
    parse_json_string(response, "watchFolder", config->watch_folder, sizeof(config->watch_folder));
    parse_json_string(response, "remoteDestination", config->remote_destination, sizeof(config->remote_destination));
    config->poll_interval_sec = parse_json_int(response, "pollIntervalSec");
    config->enabled = parse_json_bool(response, "enabled");
    config->max_file_size_mb = parse_json_int(response, "maxFileSizeMB");

    return 0;
}

int sync_service_update_config(const SyncConfig *config) {
    char body[2048];
    char response[256];

    // Build JSON (simple approach, manually)
    snprintf(body, sizeof(body),
        "{"
        "\"serverUrl\":\"%s\","
        "\"username\":\"%s\","
        "\"password\":\"%s\","
        "\"watchFolder\":\"%s\","
        "\"remoteDestination\":\"%s\","
        "\"pollIntervalSec\":%d,"
        "\"enabled\":%s,"
        "\"maxFileSizeMB\":%d"
        "}",
        config->server_url,
        config->username,
        config->password,
        config->watch_folder,
        config->remote_destination,
        config->poll_interval_sec,
        config->enabled ? "true" : "false",
        config->max_file_size_mb
    );

    return http_post(SERVICE_URL "/config", body, response, sizeof(response));
}

int sync_service_test_connection(char *error_msg, size_t error_len) {
    char response[1024];

    if (error_msg && error_len > 0) {
        error_msg[0] = '\0';
    }

    if (http_post(SERVICE_URL "/test-connection", NULL, response, sizeof(response)) != 0) {
        if (error_msg) {
            snprintf(error_msg, error_len, "Cannot connect to sync service");
        }
        return -1;
    }

    int success = parse_json_bool(response, "success");
    if (!success && error_msg) {
        parse_json_string(response, "error", error_msg, error_len);
    }

    return success ? 0 : -1;
}

int sync_service_is_running(void) {
    char response[256];

    if (http_get(SERVICE_URL "/health", response, sizeof(response)) != 0) {
        return 0;
    }

    return 1;
}
