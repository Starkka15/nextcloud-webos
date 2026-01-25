#ifndef HTTP_CLIENT_H
#define HTTP_CLIENT_H

#include <stddef.h>

// Sync service status
typedef struct {
    int running;
    int configured;
    char watch_folder[256];
    char remote_destination[256];
    int poll_interval_sec;
    char current_upload[256];
    int total_files;
    int pending_files;
    int synced_files;
    int error_files;
} SyncStatus;

// Sync configuration
typedef struct {
    char server_url[512];
    char username[128];
    char password[256];
    char watch_folder[256];
    char remote_destination[256];
    int poll_interval_sec;
    int enabled;
    int max_file_size_mb;
} SyncConfig;

// HTTP client functions
int http_get(const char *url, char *response, size_t max_len);
int http_post(const char *url, const char *body, char *response, size_t max_len);

// Sync service API
int sync_service_get_status(SyncStatus *status);
int sync_service_start(void);
int sync_service_stop(void);
int sync_service_sync_now(void);
int sync_service_get_config(SyncConfig *config);
int sync_service_update_config(const SyncConfig *config);
int sync_service_test_connection(char *error_msg, size_t error_len);
int sync_service_is_running(void);

#endif /* HTTP_CLIENT_H */
