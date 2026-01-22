#ifndef UI_H
#define UI_H

#include <SDL.h>
#include <SDL_ttf.h>
#include "xml_parser.h"
#include "config.h"

// Screen dimensions (TouchPad)
#define SCREEN_WIDTH 1024
#define SCREEN_HEIGHT 768

// UI colors (RGBA)
#define COLOR_BG        0x1a1a2eFF
#define COLOR_HEADER    0x16213eFF
#define COLOR_ITEM_BG   0x0f3460FF
#define COLOR_ITEM_SEL  0xe94560FF
#define COLOR_TEXT      0xFFFFFFFF
#define COLOR_TEXT_DIM  0xAAAAAAFF
#define COLOR_FOLDER    0x4FC3F7FF
#define COLOR_FILE      0xFFFFFFFF

// UI element sizes
#define HEADER_HEIGHT   60
#define ITEM_HEIGHT     50
#define ITEM_PADDING    10
#define FONT_SIZE       20
#define FONT_SIZE_SMALL 16

typedef enum {
    SCREEN_LOGIN,
    SCREEN_BROWSER,
    SCREEN_LOCAL_BROWSER,  // For selecting local files to upload
    SCREEN_LOADING,
    SCREEN_ERROR
} ScreenState;

typedef struct {
    SDL_Surface *screen;
    TTF_Font *font;
    TTF_Font *font_small;
    ScreenState state;

    // Login screen
    char input_server[512];
    char input_username[128];
    char input_password[256];
    int input_field;  // 0=server, 1=user, 2=pass
    int show_password;

    // Browser screen
    FileList file_list;
    int selected_index;
    int scroll_offset;
    char current_path[1024];

    // Loading/error
    char status_message[256];

    // Touch handling
    int touch_start_x;
    int touch_start_y;
    int touch_moved;      // Did finger move significantly?
    int touch_scrolling;
    int scroll_velocity;  // For momentum scrolling

    // Local file browser (for uploads)
    FileList local_files;
    int local_selected;
    int local_scroll_offset;
    char local_path[1024];
} UIState;

// Initialize UI subsystem
int ui_init(UIState *ui);

// Cleanup UI
void ui_cleanup(UIState *ui);

// Render current screen
void ui_render(UIState *ui);

// Handle SDL event, returns 1 if should quit
int ui_handle_event(UIState *ui, SDL_Event *event, AppConfig *config);

// Set screen state
void ui_set_screen(UIState *ui, ScreenState state);

// Set status/error message
void ui_set_message(UIState *ui, const char *message);

// Update file list display
void ui_set_file_list(UIState *ui, const FileList *list, const char *path);

// Get selected file entry (NULL if none)
FileEntry *ui_get_selected(UIState *ui);

// Get selected local file entry (NULL if none)
FileEntry *ui_get_local_selected(UIState *ui);

// Scan local directory for upload selection
int ui_scan_local_directory(UIState *ui, const char *path);

#endif /* UI_H */
