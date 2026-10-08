# Nextcloud for webOS

A Nextcloud client for the HP TouchPad, written in Enyo 1.

- Browse your files and folders, with thumbnails for pictures and videos
- Download files to the TouchPad (`/media/internal/Nextcloud`, same folders as on the server) and open them
- Upload files from the TouchPad
- New folder, rename, delete
- **Auto-upload**: new photos and videos (and screenshots, if you like) are sent to a
  folder on the server about every 15 minutes, with the app closed

What is planned is in [TODO.md](TODO.md).

## Requirements

A TouchPad running [webOS Community Edition](https://github.com/webOSArchive/webOS-Community-Edition)
3.1.0 or later. The app needs its modern HTTPS, both for its own requests and for the
`curl` its service uses for transfers. On stock webOS 3.0.5 it can only reach a
server over plain http.

## Signing in

Enter the server address, your user name and your password. If the account uses
two-step sign-in, make an app password on the server (Settings, Security) and
enter that.

## Auto-upload

App menu (the app's name, top left), Auto-Upload. Pick the folder on the server,
whether to include screenshots, and whether to wait for Wi-Fi. A file is sent once:
deleting it on the server does not send it again.

## Layout

| Folder | What it is |
|---|---|
| `app/` | The Enyo 1 app |
| `service/` | A node service that runs `curl` for downloads, uploads, thumbnails and auto-upload |
| `package/` | Package description that ties the two together |
| `tools/` | Build, install and test scripts for a TouchPad on USB |

## Building

With the webOS SDK's `palm-package` on the path:

```
palm-package app service package
palm-install com.stark.nextcloud_*_all.ipk
```

`tools/deploy.ps1` does this and relaunches the app on a connected TouchPad; set
the two paths at its top for your machine.

After installing a new build, the service keeps running its old code until it has
been idle for two minutes.

## History

This replaces an earlier native (PDK) version, which is kept on the `pdk` branch.

## License

GPL-3.0. See [LICENSE](LICENSE).
