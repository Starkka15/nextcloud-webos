#include <SDL.h>
#include <PDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config.h"
#include "webdav.h"
#include "ui.h"
#include "http_client.h"

#define CONFIG_FILE "/media/internal/appdata/org.webos.nextcloud/config.txt"
#define SERVICE_PATH "/media/cryptofs/apps/usr/palm/applications/org.webos.nextcloud/services/org.webos.nextcloud.service"
#define DOWNLOAD_DIR "/media/internal/downloads/"
#define LOCAL_ROOT "/media/internal"

static AppConfig config;
static UIState ui;

// Ensure config directory exists
static void ensure_config_dir(void) {
    // webOS doesn't have mkdir in PDK easily, we'll just try to save
    // The directory should exist if the app was installed properly
}

// Start the sync service if not already running
static void start_sync_service(void) {
    // Check if service is already running
    if (sync_service_is_running()) {
        printf("Sync service already running\n");
        return;
    }

    printf("Starting sync service...\n");

    // Start the Node.js service in the background
    // Use absolute path since PATH may not be set when launched from GUI
    char cmd[512];
    snprintf(cmd, sizeof(cmd),
        "cd %s && nohup /bin/node main.js >> /tmp/nextcloud-sync.log 2>&1 &",
        SERVICE_PATH);

    system(cmd);

    // Give the service a moment to start
    SDL_Delay(500);

    if (sync_service_is_running()) {
        printf("Sync service started successfully\n");
    } else {
        printf("Failed to start sync service\n");
    }
}

// Navigate to a directory
static void navigate_to(const char *path) {
    ui_set_screen(&ui, SCREEN_LOADING);
    ui_set_message(&ui, "Loading directory...");
    ui_render(&ui);

    FileList list;
    if (webdav_list_directory(&config, path, &list) == 0) {
        strncpy(config.current_path, path, sizeof(config.current_path) - 1);
        ui_set_file_list(&ui, &list, path);
        ui_set_screen(&ui, SCREEN_BROWSER);
    } else {
        ui_set_message(&ui, webdav_get_error());
        ui_set_screen(&ui, SCREEN_ERROR);
    }
}

// Go up one directory level
static void navigate_up(void) {
    if (strcmp(config.current_path, "/") == 0) {
        return;
    }

    char new_path[MAX_PATH_LEN];
    strncpy(new_path, config.current_path, sizeof(new_path) - 1);

    // Remove trailing slash if present
    int len = strlen(new_path);
    if (len > 1 && new_path[len - 1] == '/') {
        new_path[len - 1] = '\0';
        len--;
    }

    // Find last slash
    char *last_slash = strrchr(new_path, '/');
    if (last_slash && last_slash != new_path) {
        *last_slash = '\0';
    } else {
        strcpy(new_path, "/");
    }

    navigate_to(new_path);
}

// Handle file selection (download) or directory (navigate)
static void handle_selection(void) {
    FileEntry *entry = ui_get_selected(&ui);
    if (!entry) return;

    if (entry->type == ENTRY_DIRECTORY) {
        // Navigate into directory
        char new_path[MAX_PATH_LEN];
        if (strcmp(config.current_path, "/") == 0) {
            snprintf(new_path, sizeof(new_path), "/%s", entry->name);
        } else {
            snprintf(new_path, sizeof(new_path), "%s/%s", config.current_path, entry->name);
        }
        navigate_to(new_path);
    } else {
        // Download file
        ui_set_screen(&ui, SCREEN_LOADING);
        char msg[512];
        snprintf(msg, sizeof(msg), "Downloading %s...", entry->name);
        ui_set_message(&ui, msg);
        ui_render(&ui);

        char remote_path[MAX_PATH_LEN];
        if (strcmp(config.current_path, "/") == 0) {
            snprintf(remote_path, sizeof(remote_path), "/%s", entry->name);
        } else {
            snprintf(remote_path, sizeof(remote_path), "%s/%s", config.current_path, entry->name);
        }

        char local_path[MAX_PATH_LEN];
        snprintf(local_path, sizeof(local_path), "%s%s", DOWNLOAD_DIR, entry->name);

        if (webdav_download_file(&config, remote_path, local_path, NULL, NULL) == 0) {
            snprintf(msg, sizeof(msg), "Downloaded to %s", local_path);
            ui_set_message(&ui, msg);
            // Stay on loading screen briefly to show success
            ui_render(&ui);
            SDL_Delay(1500);
            ui_set_screen(&ui, SCREEN_BROWSER);
        } else {
            ui_set_message(&ui, webdav_get_error());
            ui_set_screen(&ui, SCREEN_ERROR);
        }
    }
}

// Show local file picker for upload
static void show_upload_picker(void) {
    if (ui_scan_local_directory(&ui, LOCAL_ROOT) == 0) {
        ui_set_screen(&ui, SCREEN_LOCAL_BROWSER);
    } else {
        ui_set_message(&ui, "Cannot access local files");
        ui_set_screen(&ui, SCREEN_ERROR);
    }
}

// Handle local file/directory selection
static void handle_local_selection(void) {
    FileEntry *entry = ui_get_local_selected(&ui);
    if (!entry) return;

    if (strcmp(entry->name, "..") == 0) {
        // Go up in local filesystem
        char *last_slash = strrchr(ui.local_path, '/');
        if (last_slash && last_slash != ui.local_path) {
            char parent[1024];
            size_t len = last_slash - ui.local_path;
            strncpy(parent, ui.local_path, len);
            parent[len] = '\0';
            ui_scan_local_directory(&ui, parent);
        }
    } else if (entry->type == ENTRY_DIRECTORY) {
        // Navigate into local directory
        ui_scan_local_directory(&ui, entry->href);
    } else {
        // Upload selected file
        ui_set_screen(&ui, SCREEN_LOADING);
        char msg[512];
        snprintf(msg, sizeof(msg), "Uploading %s...", entry->name);
        ui_set_message(&ui, msg);
        ui_render(&ui);

        char remote_path[MAX_PATH_LEN];
        if (strcmp(config.current_path, "/") == 0) {
            snprintf(remote_path, sizeof(remote_path), "/%s", entry->name);
        } else {
            snprintf(remote_path, sizeof(remote_path), "%s/%s", config.current_path, entry->name);
        }

        if (webdav_upload_file(&config, entry->href, remote_path, NULL, NULL) == 0) {
            snprintf(msg, sizeof(msg), "Uploaded %s", entry->name);
            ui_set_message(&ui, msg);
            ui_render(&ui);
            SDL_Delay(1500);
            // Refresh remote directory
            navigate_to(config.current_path);
        } else {
            ui_set_message(&ui, webdav_get_error());
            ui_set_screen(&ui, SCREEN_ERROR);
        }
    }
}

// Attempt to connect to server
static void attempt_connect(void) {
    ui_set_screen(&ui, SCREEN_LOADING);
    ui_set_message(&ui, "Connecting...");
    ui_render(&ui);

    if (webdav_test_connection(&config) == 0) {
        // Save config on successful connection
        ensure_config_dir();
        config_save(&config, CONFIG_FILE);

        // Update sync service with the same credentials
        if (sync_service_is_running()) {
            SyncConfig sync_cfg;
            sync_service_get_config(&sync_cfg);
            strncpy(sync_cfg.server_url, config.server_url, sizeof(sync_cfg.server_url) - 1);
            strncpy(sync_cfg.username, config.username, sizeof(sync_cfg.username) - 1);
            strncpy(sync_cfg.password, config.password, sizeof(sync_cfg.password) - 1);
            sync_service_update_config(&sync_cfg);
        }

        // Navigate to root
        navigate_to("/");
    } else {
        ui_set_message(&ui, webdav_get_error());
        ui_set_screen(&ui, SCREEN_ERROR);
    }
}

int main(int argc, char *argv[]) {
    // Initialize SDL
    if (SDL_Init(SDL_INIT_VIDEO) < 0) {
        fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
        return 1;
    }

    // Initialize PDL
    PDL_Init(0);

    // Initialize WebDAV/curl
    if (webdav_init() != 0) {
        fprintf(stderr, "webdav_init failed: %s\n", webdav_get_error());
        SDL_Quit();
        return 1;
    }

    // Initialize config
    config_init(&config);

    // Try to load saved config
    if (config_load(&config, CONFIG_FILE) == 0 && config.server_url[0]) {
        // Have saved config, pre-fill login screen
    }

    // Initialize UI
    if (ui_init(&ui) != 0) {
        fprintf(stderr, "ui_init failed\n");
        webdav_cleanup();
        SDL_Quit();
        return 1;
    }

    // Pre-fill UI with loaded config
    strncpy(ui.input_server, config.server_url, sizeof(ui.input_server) - 1);
    strncpy(ui.input_username, config.username, sizeof(ui.input_username) - 1);
    if (config.remember_password) {
        strncpy(ui.input_password, config.password, sizeof(ui.input_password) - 1);
    }

    // Start the sync service
    start_sync_service();

    // Main loop
    int running = 1;
    while (running) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            int result = ui_handle_event(&ui, &event, &config);

            switch (result) {
                case 1: // Quit
                    running = 0;
                    break;
                case 2: // Connect button
                    attempt_connect();
                    break;
                case 3: // Back/up
                    if (ui.state == SCREEN_BROWSER) {
                        navigate_up();
                    }
                    break;
                case 4: // Item selected
                    handle_selection();
                    break;
                case 5: // Upload button pressed
                    show_upload_picker();
                    break;
                case 6: // Cancel upload picker
                    ui_set_screen(&ui, SCREEN_BROWSER);
                    break;
                case 7: // Local file selected for upload
                    handle_local_selection();
                    break;
            }
        }

        ui_render(&ui);
        SDL_Delay(16); // ~60 FPS cap
    }

    // Cleanup
    ui_cleanup(&ui);
    webdav_cleanup();
    PDL_Quit();
    SDL_Quit();

    return 0;
}
