#include "ui.h"
#include <stdio.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>
#include <PDL.h>

// Helper to convert hex color to SDL_Color
static SDL_Color hex_to_color(Uint32 hex) {
    SDL_Color c;
    c.r = (hex >> 24) & 0xFF;
    c.g = (hex >> 16) & 0xFF;
    c.b = (hex >> 8) & 0xFF;
    c.unused = hex & 0xFF;
    return c;
}

// Draw filled rectangle
static void draw_rect(SDL_Surface *surface, int x, int y, int w, int h, Uint32 color) {
    SDL_Rect rect = {x, y, w, h};
    SDL_FillRect(surface, &rect, SDL_MapRGBA(surface->format,
        (color >> 24) & 0xFF,
        (color >> 16) & 0xFF,
        (color >> 8) & 0xFF,
        color & 0xFF));
}

// Draw text
static void draw_text(SDL_Surface *surface, TTF_Font *font, const char *text,
                      int x, int y, Uint32 color) {
    if (!text || !text[0]) return;

    SDL_Color c = hex_to_color(color);
    SDL_Surface *text_surface = TTF_RenderUTF8_Blended(font, text, c);
    if (text_surface) {
        SDL_Rect dest = {x, y, 0, 0};
        SDL_BlitSurface(text_surface, NULL, surface, &dest);
        SDL_FreeSurface(text_surface);
    }
}

// Draw text centered
static void draw_text_centered(SDL_Surface *surface, TTF_Font *font, const char *text,
                               int y, Uint32 color) {
    if (!text || !text[0]) return;

    int w, h;
    TTF_SizeUTF8(font, text, &w, &h);
    draw_text(surface, font, text, (SCREEN_WIDTH - w) / 2, y, color);
}

// Format file size
static void format_size(long long bytes, char *out, size_t out_len) {
    if (bytes < 1024) {
        snprintf(out, out_len, "%lld B", bytes);
    } else if (bytes < 1024 * 1024) {
        snprintf(out, out_len, "%.1f KB", bytes / 1024.0);
    } else if (bytes < 1024 * 1024 * 1024) {
        snprintf(out, out_len, "%.1f MB", bytes / (1024.0 * 1024.0));
    } else {
        snprintf(out, out_len, "%.1f GB", bytes / (1024.0 * 1024.0 * 1024.0));
    }
}

int ui_init(UIState *ui) {
    memset(ui, 0, sizeof(UIState));

    ui->screen = SDL_SetVideoMode(SCREEN_WIDTH, SCREEN_HEIGHT, 32, SDL_SWSURFACE);
    if (!ui->screen) {
        fprintf(stderr, "SDL_SetVideoMode failed: %s\n", SDL_GetError());
        return -1;
    }

    // Enable unicode for proper virtual keyboard input
    SDL_EnableUNICODE(1);

    if (TTF_Init() == -1) {
        fprintf(stderr, "TTF_Init failed: %s\n", TTF_GetError());
        return -1;
    }

    // Try to load a font - webOS has Prelude fonts
    const char *font_paths[] = {
        "/usr/share/fonts/Prelude-Medium.ttf",
        "/usr/share/fonts/PreludeWGL-Medium.ttf",
        "/usr/share/fonts/cour.ttf",
        "/usr/share/fonts/times.ttf",
        NULL
    };

    for (int i = 0; font_paths[i]; i++) {
        ui->font = TTF_OpenFont(font_paths[i], FONT_SIZE);
        if (ui->font) {
            ui->font_small = TTF_OpenFont(font_paths[i], FONT_SIZE_SMALL);
            break;
        }
    }

    if (!ui->font) {
        fprintf(stderr, "Could not load font\n");
        return -1;
    }

    ui->state = SCREEN_LOGIN;
    ui->input_field = 0;
    strcpy(ui->current_path, "/");

    return 0;
}

void ui_cleanup(UIState *ui) {
    if (ui->font) TTF_CloseFont(ui->font);
    if (ui->font_small) TTF_CloseFont(ui->font_small);
    TTF_Quit();
}

static void render_login(UIState *ui) {
    // Background
    draw_rect(ui->screen, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, COLOR_BG);

    // Title
    draw_text_centered(ui->screen, ui->font, "Nextcloud Login", 100, COLOR_TEXT);

    int start_y = 200;
    int field_width = 400;
    int field_x = (SCREEN_WIDTH - field_width) / 2;

    // Server URL field
    draw_text(ui->screen, ui->font_small, "Server URL:", field_x, start_y, COLOR_TEXT_DIM);
    draw_rect(ui->screen, field_x, start_y + 25, field_width, 35,
              ui->input_field == 0 ? COLOR_ITEM_SEL : COLOR_ITEM_BG);
    draw_text(ui->screen, ui->font, ui->input_server, field_x + 5, start_y + 28, COLOR_TEXT);

    // Username field
    start_y += 80;
    draw_text(ui->screen, ui->font_small, "Username:", field_x, start_y, COLOR_TEXT_DIM);
    draw_rect(ui->screen, field_x, start_y + 25, field_width, 35,
              ui->input_field == 1 ? COLOR_ITEM_SEL : COLOR_ITEM_BG);
    draw_text(ui->screen, ui->font, ui->input_username, field_x + 5, start_y + 28, COLOR_TEXT);

    // Password field
    start_y += 80;
    draw_text(ui->screen, ui->font_small, "Password:", field_x, start_y, COLOR_TEXT_DIM);
    draw_rect(ui->screen, field_x, start_y + 25, field_width, 35,
              ui->input_field == 2 ? COLOR_ITEM_SEL : COLOR_ITEM_BG);
    // Mask password
    char masked[256];
    int pass_len = strlen(ui->input_password);
    if (pass_len > 255) pass_len = 255;
    memset(masked, '*', pass_len);
    masked[pass_len] = '\0';
    draw_text(ui->screen, ui->font, masked, field_x + 5, start_y + 28, COLOR_TEXT);

    // Connect button
    start_y += 100;
    draw_rect(ui->screen, field_x, start_y, field_width, 45, COLOR_ITEM_SEL);
    draw_text_centered(ui->screen, ui->font, "Connect", start_y + 10, COLOR_TEXT);

    // Instructions
    draw_text_centered(ui->screen, ui->font_small,
                       "Tap field to select, use keyboard to type", 650, COLOR_TEXT_DIM);
    draw_text_centered(ui->screen, ui->font_small,
                       "Example: https://cloud.example.com", 680, COLOR_TEXT_DIM);
}

static void render_browser(UIState *ui) {
    // Background
    draw_rect(ui->screen, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, COLOR_BG);

    // Header
    draw_rect(ui->screen, 0, 0, SCREEN_WIDTH, HEADER_HEIGHT, COLOR_HEADER);

    // Path (truncate if too long)
    char display_path[64];
    if (strlen(ui->current_path) > 40) {
        snprintf(display_path, sizeof(display_path), "...%s", ui->current_path + strlen(ui->current_path) - 37);
    } else {
        strncpy(display_path, ui->current_path, sizeof(display_path));
    }
    draw_text(ui->screen, ui->font, display_path, 10, 18, COLOR_TEXT);

    // Upload button
    draw_rect(ui->screen, SCREEN_WIDTH - 220, 10, 80, 40, COLOR_ITEM_SEL);
    draw_text(ui->screen, ui->font_small, "Upload", SCREEN_WIDTH - 210, 20, COLOR_TEXT);

    // Back button
    if (strcmp(ui->current_path, "/") != 0) {
        draw_rect(ui->screen, SCREEN_WIDTH - 120, 10, 80, 40, COLOR_ITEM_BG);
        draw_text(ui->screen, ui->font_small, "Back", SCREEN_WIDTH - 105, 20, COLOR_TEXT);
    }

    // File list
    int visible_items = (SCREEN_HEIGHT - HEADER_HEIGHT) / ITEM_HEIGHT;
    int y = HEADER_HEIGHT;

    for (int i = 0; i < visible_items && (i + ui->scroll_offset) < ui->file_list.count; i++) {
        int idx = i + ui->scroll_offset;
        FileEntry *entry = &ui->file_list.entries[idx];

        // Item background
        Uint32 bg_color = (idx == ui->selected_index) ? COLOR_ITEM_SEL : COLOR_ITEM_BG;
        draw_rect(ui->screen, 0, y, SCREEN_WIDTH, ITEM_HEIGHT - 2, bg_color);

        // Icon/indicator
        const char *icon = (entry->type == ENTRY_DIRECTORY) ? "[D]" : "[F]";
        Uint32 icon_color = (entry->type == ENTRY_DIRECTORY) ? COLOR_FOLDER : COLOR_FILE;
        draw_text(ui->screen, ui->font, icon, 10, y + 12, icon_color);

        // Filename
        draw_text(ui->screen, ui->font, entry->name, 60, y + 12, COLOR_TEXT);

        // Size (files only)
        if (entry->type == ENTRY_FILE && entry->size > 0) {
            char size_str[32];
            format_size(entry->size, size_str, sizeof(size_str));
            draw_text(ui->screen, ui->font_small, size_str, SCREEN_WIDTH - 100, y + 15, COLOR_TEXT_DIM);
        }

        y += ITEM_HEIGHT;
    }

    // Scroll indicator
    if (ui->file_list.count > visible_items) {
        int scroll_height = (SCREEN_HEIGHT - HEADER_HEIGHT) * visible_items / ui->file_list.count;
        int scroll_pos = HEADER_HEIGHT +
            (SCREEN_HEIGHT - HEADER_HEIGHT - scroll_height) * ui->scroll_offset /
            (ui->file_list.count - visible_items);
        draw_rect(ui->screen, SCREEN_WIDTH - 5, scroll_pos, 5, scroll_height, COLOR_ITEM_SEL);
    }
}

static void render_local_browser(UIState *ui) {
    // Background
    draw_rect(ui->screen, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, COLOR_BG);

    // Header
    draw_rect(ui->screen, 0, 0, SCREEN_WIDTH, HEADER_HEIGHT, COLOR_HEADER);
    draw_text(ui->screen, ui->font, "Select file to upload", 10, 18, COLOR_TEXT);

    // Cancel button
    draw_rect(ui->screen, SCREEN_WIDTH - 120, 10, 100, 40, COLOR_ITEM_BG);
    draw_text(ui->screen, ui->font_small, "Cancel", SCREEN_WIDTH - 105, 20, COLOR_TEXT);

    // Local path
    draw_text(ui->screen, ui->font_small, ui->local_path, 10, 45, COLOR_TEXT_DIM);

    // File list
    int visible_items = (SCREEN_HEIGHT - HEADER_HEIGHT) / ITEM_HEIGHT;
    int y = HEADER_HEIGHT;

    for (int i = 0; i < visible_items && (i + ui->local_scroll_offset) < ui->local_files.count; i++) {
        int idx = i + ui->local_scroll_offset;
        FileEntry *entry = &ui->local_files.entries[idx];

        Uint32 bg_color = (idx == ui->local_selected) ? COLOR_ITEM_SEL : COLOR_ITEM_BG;
        draw_rect(ui->screen, 0, y, SCREEN_WIDTH, ITEM_HEIGHT - 2, bg_color);

        const char *icon = (entry->type == ENTRY_DIRECTORY) ? "[D]" : "[F]";
        Uint32 icon_color = (entry->type == ENTRY_DIRECTORY) ? COLOR_FOLDER : COLOR_FILE;
        draw_text(ui->screen, ui->font, icon, 10, y + 12, icon_color);

        draw_text(ui->screen, ui->font, entry->name, 60, y + 12, COLOR_TEXT);

        if (entry->type == ENTRY_FILE && entry->size > 0) {
            char size_str[32];
            format_size(entry->size, size_str, sizeof(size_str));
            draw_text(ui->screen, ui->font_small, size_str, SCREEN_WIDTH - 100, y + 15, COLOR_TEXT_DIM);
        }

        y += ITEM_HEIGHT;
    }

    // Scroll indicator
    if (ui->local_files.count > visible_items) {
        int scroll_height = (SCREEN_HEIGHT - HEADER_HEIGHT) * visible_items / ui->local_files.count;
        int scroll_pos = HEADER_HEIGHT +
            (SCREEN_HEIGHT - HEADER_HEIGHT - scroll_height) * ui->local_scroll_offset /
            (ui->local_files.count - visible_items);
        draw_rect(ui->screen, SCREEN_WIDTH - 5, scroll_pos, 5, scroll_height, COLOR_ITEM_SEL);
    }
}

static void render_loading(UIState *ui) {
    draw_rect(ui->screen, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, COLOR_BG);
    draw_text_centered(ui->screen, ui->font, "Loading...", SCREEN_HEIGHT / 2 - 30, COLOR_TEXT);
    draw_text_centered(ui->screen, ui->font_small, ui->status_message, SCREEN_HEIGHT / 2 + 10, COLOR_TEXT_DIM);
}

static void render_error(UIState *ui) {
    draw_rect(ui->screen, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, COLOR_BG);
    draw_text_centered(ui->screen, ui->font, "Error", SCREEN_HEIGHT / 2 - 50, COLOR_ITEM_SEL);
    draw_text_centered(ui->screen, ui->font, ui->status_message, SCREEN_HEIGHT / 2, COLOR_TEXT);
    draw_text_centered(ui->screen, ui->font_small, "Tap to go back", SCREEN_HEIGHT / 2 + 50, COLOR_TEXT_DIM);
}

void ui_render(UIState *ui) {
    switch (ui->state) {
        case SCREEN_LOGIN:
            render_login(ui);
            break;
        case SCREEN_BROWSER:
            render_browser(ui);
            break;
        case SCREEN_LOCAL_BROWSER:
            render_local_browser(ui);
            break;
        case SCREEN_LOADING:
            render_loading(ui);
            break;
        case SCREEN_ERROR:
            render_error(ui);
            break;
    }

    SDL_Flip(ui->screen);
}

int ui_handle_event(UIState *ui, SDL_Event *event, AppConfig *config) {
    if (event->type == SDL_QUIT) {
        return 1;
    }

    if (event->type == SDL_MOUSEBUTTONDOWN) {
        int x = event->button.x;
        int y = event->button.y;

        if (ui->state == SCREEN_LOGIN) {
            int field_x = (SCREEN_WIDTH - 400) / 2;
            int field_w = 400;

            // Check which field was tapped
            int field_tapped = 0;
            if (x >= field_x && x <= field_x + field_w) {
                if (y >= 225 && y <= 260) {
                    ui->input_field = 0;      // Server
                    PDL_SetKeyboardState(PDL_TRUE);
                    field_tapped = 1;
                }
                else if (y >= 305 && y <= 340) {
                    ui->input_field = 1; // Username
                    PDL_SetKeyboardState(PDL_TRUE);
                    field_tapped = 1;
                }
                else if (y >= 385 && y <= 420) {
                    ui->input_field = 2; // Password
                    PDL_SetKeyboardState(PDL_TRUE);
                    field_tapped = 1;
                }
                else if (y >= 460 && y <= 505) {
                    // Connect button pressed
                    PDL_SetKeyboardState(PDL_FALSE);
                    strcpy(config->server_url, ui->input_server);
                    strcpy(config->username, ui->input_username);
                    strcpy(config->password, ui->input_password);
                    return 2; // Signal to attempt connection
                }
            }
            // Tap outside fields dismisses keyboard
            if (!field_tapped) {
                PDL_SetKeyboardState(PDL_FALSE);
            }
        }
        else if (ui->state == SCREEN_BROWSER) {
            // Start touch tracking
            ui->touch_start_x = x;
            ui->touch_start_y = y;
            ui->touch_moved = 0;
            ui->touch_scrolling = 1;
        }
        else if (ui->state == SCREEN_ERROR) {
            ui->state = SCREEN_LOGIN;
        }
    }

    if (event->type == SDL_MOUSEMOTION && ui->touch_scrolling) {
        int dy = ui->touch_start_y - event->motion.y;
        if (abs(dy) > 15) {  // Threshold to start scrolling
            ui->touch_moved = 1;
            int visible_items = (SCREEN_HEIGHT - HEADER_HEIGHT) / ITEM_HEIGHT;
            int max_scroll = ui->file_list.count - visible_items;
            if (max_scroll < 0) max_scroll = 0;

            // Smoother scrolling - pixel based
            ui->scroll_offset += dy / 20;
            if (ui->scroll_offset < 0) ui->scroll_offset = 0;
            if (ui->scroll_offset > max_scroll) ui->scroll_offset = max_scroll;

            ui->touch_start_y = event->motion.y;
        }
    }

    if (event->type == SDL_MOUSEBUTTONUP) {
        int x = event->button.x;
        int y = event->button.y;

        if (ui->state == SCREEN_BROWSER && !ui->touch_moved) {
            // This was a tap, not a scroll

            // Check header buttons
            if (y < HEADER_HEIGHT) {
                // Upload button
                if (x >= SCREEN_WIDTH - 220 && x <= SCREEN_WIDTH - 140) {
                    ui->touch_scrolling = 0;
                    return 5; // Signal to show upload picker
                }
                // Back button
                if (x >= SCREEN_WIDTH - 120) {
                    ui->touch_scrolling = 0;
                    return 3; // Signal to go back
                }
            }
            // Item selection
            else if (y >= HEADER_HEIGHT) {
                int item_idx = (y - HEADER_HEIGHT) / ITEM_HEIGHT + ui->scroll_offset;
                if (item_idx >= 0 && item_idx < ui->file_list.count) {
                    ui->selected_index = item_idx;
                    ui->touch_scrolling = 0;
                    return 4; // Signal item selected
                }
            }
        }
        else if (ui->state == SCREEN_LOCAL_BROWSER && !ui->touch_moved) {
            // Local file browser tap handling
            if (y < HEADER_HEIGHT) {
                // Cancel button
                if (x >= SCREEN_WIDTH - 120) {
                    ui->touch_scrolling = 0;
                    return 6; // Cancel upload picker
                }
            }
            else if (y >= HEADER_HEIGHT) {
                int item_idx = (y - HEADER_HEIGHT) / ITEM_HEIGHT + ui->local_scroll_offset;
                if (item_idx >= 0 && item_idx < ui->local_files.count) {
                    ui->local_selected = item_idx;
                    ui->touch_scrolling = 0;
                    return 7; // Local file selected for upload
                }
            }
        }

        ui->touch_scrolling = 0;
        ui->touch_moved = 0;
    }

    if (event->type == SDL_KEYDOWN) {
        if (ui->state == SCREEN_LOGIN) {
            char *target = NULL;
            int max_len = 0;

            switch (ui->input_field) {
                case 0: target = ui->input_server; max_len = sizeof(ui->input_server) - 1; break;
                case 1: target = ui->input_username; max_len = sizeof(ui->input_username) - 1; break;
                case 2: target = ui->input_password; max_len = sizeof(ui->input_password) - 1; break;
            }

            if (target) {
                int len = strlen(target);
                SDLKey key = event->key.keysym.sym;

                if (key == SDLK_BACKSPACE && len > 0) {
                    target[len - 1] = '\0';
                }
                else if (key == SDLK_RETURN) {
                    if (ui->input_field == 2) {
                        // On password field, dismiss keyboard
                        PDL_SetKeyboardState(PDL_FALSE);
                    } else {
                        // Move to next field
                        ui->input_field = (ui->input_field + 1) % 3;
                    }
                }
                else if (key == SDLK_TAB) {
                    ui->input_field = (ui->input_field + 1) % 3;
                }
                else {
                    // Use unicode value for proper virtual keyboard support
                    Uint16 unicode = event->key.keysym.unicode;
                    if (unicode >= 32 && unicode < 127 && len < max_len) {
                        target[len] = (char)unicode;
                        target[len + 1] = '\0';
                    }
                }
            }
        }
        else if (ui->state == SCREEN_BROWSER) {
            SDLKey key = event->key.keysym.sym;
            int visible_items = (SCREEN_HEIGHT - HEADER_HEIGHT) / ITEM_HEIGHT;

            if (key == SDLK_UP && ui->selected_index > 0) {
                ui->selected_index--;
                if (ui->selected_index < ui->scroll_offset) {
                    ui->scroll_offset = ui->selected_index;
                }
            }
            else if (key == SDLK_DOWN && ui->selected_index < ui->file_list.count - 1) {
                ui->selected_index++;
                if (ui->selected_index >= ui->scroll_offset + visible_items) {
                    ui->scroll_offset = ui->selected_index - visible_items + 1;
                }
            }
            else if (key == SDLK_RETURN) {
                return 4; // Item selected
            }
            else if (key == SDLK_BACKSPACE || key == SDLK_ESCAPE) {
                return 3; // Go back
            }
        }
    }

    return 0;
}

void ui_set_screen(UIState *ui, ScreenState state) {
    ui->state = state;
    // Hide keyboard when leaving login screen
    if (state != SCREEN_LOGIN) {
        PDL_SetKeyboardState(PDL_FALSE);
    }
}

void ui_set_message(UIState *ui, const char *message) {
    strncpy(ui->status_message, message, sizeof(ui->status_message) - 1);
    ui->status_message[sizeof(ui->status_message) - 1] = '\0';
}

void ui_set_file_list(UIState *ui, const FileList *list, const char *path) {
    memcpy(&ui->file_list, list, sizeof(FileList));
    strncpy(ui->current_path, path, sizeof(ui->current_path) - 1);
    ui->selected_index = 0;
    ui->scroll_offset = 0;
}

FileEntry *ui_get_selected(UIState *ui) {
    if (ui->selected_index >= 0 && ui->selected_index < ui->file_list.count) {
        return &ui->file_list.entries[ui->selected_index];
    }
    return NULL;
}

FileEntry *ui_get_local_selected(UIState *ui) {
    if (ui->local_selected >= 0 && ui->local_selected < ui->local_files.count) {
        return &ui->local_files.entries[ui->local_selected];
    }
    return NULL;
}

int ui_scan_local_directory(UIState *ui, const char *path) {
    DIR *dir = opendir(path);
    if (!dir) {
        return -1;
    }

    strncpy(ui->local_path, path, sizeof(ui->local_path) - 1);
    ui->local_files.count = 0;
    ui->local_selected = 0;
    ui->local_scroll_offset = 0;

    // Add parent directory entry if not at root
    if (strcmp(path, "/media/internal") != 0) {
        FileEntry *entry = &ui->local_files.entries[ui->local_files.count++];
        strcpy(entry->name, "..");
        strcpy(entry->href, path);
        entry->type = ENTRY_DIRECTORY;
        entry->size = 0;
    }

    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL && ui->local_files.count < MAX_ENTRIES) {
        // Skip hidden files and . / ..
        if (ent->d_name[0] == '.') continue;

        FileEntry *entry = &ui->local_files.entries[ui->local_files.count];
        strncpy(entry->name, ent->d_name, MAX_FILENAME_LEN - 1);

        // Build full path
        char full_path[1024];
        snprintf(full_path, sizeof(full_path), "%s/%s", path, ent->d_name);
        strncpy(entry->href, full_path, sizeof(entry->href) - 1);

        // Get file info
        struct stat st;
        if (stat(full_path, &st) == 0) {
            entry->type = S_ISDIR(st.st_mode) ? ENTRY_DIRECTORY : ENTRY_FILE;
            entry->size = st.st_size;
        } else {
            entry->type = ENTRY_FILE;
            entry->size = 0;
        }

        ui->local_files.count++;
    }

    closedir(dir);
    return 0;
}
