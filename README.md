# Nextcloud Client for webOS

A native PDK client for accessing Nextcloud/ownCloud servers on HP TouchPad.

## Features (Planned)

- [ ] Server login/configuration
- [ ] Browse files and folders
- [ ] Download files
- [ ] Upload files
- [ ] Create/delete folders
- [ ] Delete files
- [ ] File preview (images, text)
- [ ] Download queue
- [ ] Favorites/bookmarks

## Technical Stack

- **HTTP/WebDAV**: libcurl (included in PDK)
- **XML Parsing**: minimal custom parser or expat port
- **UI**: SDL + SDL_ttf + SDL_image
- **Config Storage**: JSON file in app directory

## Nextcloud API

Nextcloud supports WebDAV for file operations:

```
Base URL: https://your-server.com/remote.php/dav/files/USERNAME/

PROPFIND  - List directory contents
GET       - Download file
PUT       - Upload file
MKCOL     - Create directory
DELETE    - Delete file/folder
MOVE      - Move/rename
```

## Building

```bash
export WEBOS_PDK=/opt/PalmPDK
make
```

## Directory Structure

```
nextcloud-webos/
├── src/
│   ├── main.c          # Entry point, SDL init
│   ├── webdav.c        # WebDAV/curl operations
│   ├── webdav.h
│   ├── ui.c            # SDL UI rendering
│   ├── ui.h
│   ├── config.c        # Settings management
│   └── config.h
├── assets/
│   ├── fonts/
│   └── icons/
├── appinfo.json
├── Makefile
└── README.md
```
