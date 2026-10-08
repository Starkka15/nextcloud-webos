# TODO

What comes next, roughly in order of payoff. The app relies on webOS Community
Edition 3.1.0 for modern HTTPS, both in its own requests and in the `curl` its
service runs for transfers.

## Done so far

- [x] **Sign in** with a server address, user name and password or app password.
- [x] **Browse folders**, with names in any language.
- [x] **Download** a file to `/media/internal/Nextcloud`, keeping the server's folders.
- [x] **Upload** files picked on the TouchPad into the open folder.
- [x] **New folder, rename, delete.**
- [x] **Transfer bar** with progress, Cancel, and a plain message when one fails.
- [x] **Auto-upload.** New photos and videos (and screenshots, if wanted) go to a
  folder on the server about every 15 minutes, with the app closed, on Wi-Fi only
  unless told otherwise. App menu, Auto-Upload. Checked against a real Nextcloud
  server over https.
- [x] **Thumbnails** for pictures and videos, fetched by the service.

## Most worth doing

- [ ] **More checks against a real server**: a login name that differs from the
  account id, an app password, two-step sign-in, and very large folders.
- [ ] **Transfers that outlive the app.** Auto-upload does; a download or upload
  started by hand is written to finish after the app is closed, but that has not
  been confirmed, and the app does not show it again when it comes back.
- [ ] **A real icon**, in the three sizes webOS wants (64, 256 and 32 pixels).
- [ ] **Clear out old thumbnails** (they are kept in `/media/internal/.nextcloud/thumbs`
  and never removed).

## Smaller wins

- [ ] **Open pictures in the app**: swipe through the pictures of a folder without
  downloading each one by hand.
- [ ] **Skip the download when the file is already here** and unchanged (compare
  the server's etag), and say so.
- [ ] **Ask before replacing** a file on upload when the name is taken.
- [ ] **Move and copy** a file to another folder.
- [ ] **Sort** by name, date or size, and remember the choice.
- [ ] **Search** the server, and Just Type search from the launcher.
- [ ] **Favorites**: show and set the server's star, with a Favorites view.
- [ ] **Free space**: show the account's quota, and warn before a download that
  would not fit on the TouchPad.
- [ ] **Sign in through the server's own page** (Nextcloud login flow), if the
  TouchPad's browser can show it.
- [ ] **Downloads list**: what is on the TouchPad already, with a way to remove it.
- [ ] **Share links**: make a public link for a file and copy it.
- [ ] **Phone layout** for the Pre3 and Veer.

## Later

- [ ] **Two-way folder sync**: keep chosen server folders mirrored on the TouchPad.
  Needs rules for conflicts and deletions; auto-upload covers the common case first.
- [ ] **More than one account.**
- [ ] **Stock webOS 3.0.5** without Community Edition: its `curl` and WebKit cannot
  reach a modern https server, so it would only work with plain http.
