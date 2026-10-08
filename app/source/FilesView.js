/* The file browser: one folder at a time, with the actions on files and folders. */
enyo.kind({
	name: "NC.FilesView",
	kind: enyo.VFlexBox,
	className: "nc-view",
	components: [
		{className: "nc-header", kind: "HFlexBox", align: "center", components: [
			{name: "up", kind: "Button", caption: "Back", className: "nc-header-button", onclick: "goUp", showing: false},
			{kind: "VFlexBox", flex: 1, className: "nc-titles", components: [
				{name: "title", className: "nc-title", content: "Nextcloud"},
				{name: "subtitle", className: "nc-subtitle"}
			]},
			{kind: "Button", caption: "New Folder", className: "nc-header-button", onclick: "newFolderClick"},
			{kind: "Button", caption: "Upload", className: "nc-header-button", onclick: "uploadClick"}
		]},
		{name: "note", className: "nc-note", showing: false},
		{name: "list", kind: "VirtualList", flex: 1, onSetupRow: "setupRow", components: [
			{name: "row", kind: "Item", layoutKind: "HFlexLayout", align: "center", tapHighlight: true,
				className: "nc-row", onclick: "rowClick", components: [
					{name: "icon", className: "nc-icon"},
					{kind: "VFlexBox", flex: 1, className: "nc-row-text", components: [
						{name: "name", className: "nc-name"},
						{name: "info", className: "nc-info"}
					]},
					{name: "more", kind: "Button", caption: "More", className: "nc-more", onclick: "moreClick"}
				]}
		]},
		// Transfers in progress, or the last one that failed.
		{name: "bar", kind: "HFlexBox", align: "center", className: "nc-bar", showing: false, components: [
			{name: "barText", flex: 1, className: "nc-bar-text"},
			{name: "barButton", kind: "Button", caption: "Cancel", onclick: "barButtonClick"}
		]},
		// lazy: false, so its items exist before it is first opened (moreClick hides one).
		{name: "rowMenu", kind: "Menu", lazy: false, components: [
			{name: "menuDownload", caption: "Download", onclick: "menuDownload"},
			{caption: "Rename", onclick: "menuRename"},
			{caption: "Delete", onclick: "menuDelete"}
		]},
		{name: "nameDialog", kind: "ModalDialog", lazy: false, components: [
			{name: "nameInput", kind: "Input", hint: "Name", autoCapitalize: "sentence", onkeydown: "nameKey"},
			{name: "nameMessage", className: "nc-dialog-note"},
			{kind: "HFlexBox", components: [
				{kind: "Button", caption: "Cancel", flex: 1, onclick: "nameCancel"},
				{name: "nameOk", kind: "Button", caption: "OK", flex: 1, className: "enyo-button-affirmative",
					onclick: "nameOkClick"}
			]}
		]},
		{name: "confirmDialog", kind: "ModalDialog", lazy: false, caption: "Delete", components: [
			{name: "confirmText", className: "nc-dialog-note"},
			{kind: "HFlexBox", components: [
				{kind: "Button", caption: "Cancel", flex: 1, onclick: "confirmCancel"},
				{kind: "Button", caption: "Delete", flex: 1, className: "enyo-button-negative",
					onclick: "confirmDelete"}
			]}
		]},
		{name: "picker", kind: "FilePicker", allowMultiSelect: true, onPickFile: "filesPicked"},
		{name: "openSvc", kind: "PalmService", service: "palm://com.palm.applicationManager/", method: "open",
			onFailure: "openFailed"},
		{name: "thumbsSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "thumbs",
			onSuccess: "thumbsAnswer", onFailure: "thumbsFailed"}
	],

	create: function() {
		this.inherited(arguments);
		this.path = "/";
		this.entries = [];
		this.loads = 0;
		this.noThumb = {};
	},

	// ---- showing a folder ------------------------------------------------------

	openFolder: function(path) {
		this.path = path || "/";
		this.entries = [];
		this.$.list.punt();
		this.reload();
	},

	// keepPlace: the same folder again, so leave the list where it is.
	reload: function(keepPlace) {
		var load = ++this.loads;
		var path = this.path;
		this.$.title.setContent(String(path === "/" ? "Nextcloud" : NC.baseName(path)));
		this.$.subtitle.setContent(String(path === "/" ? (NC.api.displayName || NC.api.user) : NC.parent(path)));
		this.$.up.setShowing(path !== "/");
		if (!keepPlace) {
			this.showNote("Loading…");
		}
		NC.api.list(path, enyo.bind(this, function(ok, result) {
			if (load !== this.loads) {
				return;  // a newer request has been made since
			}
			if (!ok) {
				this.entries = [];
				this.$.list.punt();
				this.showNote(result);
				return;
			}
			this.entries = result;
			this.showNote(result.length ? "" : "This folder is empty.");
			if (keepPlace) {
				this.$.list.refresh();
			} else {
				this.$.list.punt();
			}
			this.thumbsAt = 0;
			this.thumbsBusy = false;
			this.moreThumbs();
		}));
	},

	// ---- thumbnails ---------------------------------------------------------------
	// The service fetches the server's previews a batch at a time (see
	// service/transfer.js); each batch that arrives is drawn straight away.

	// A short name for a path, to name its thumbnail file by.
	thumbKey: function(path) {
		var a = 5381;
		var b = 52711;
		for (var i = 0; i < path.length; i++) {
			var c = path.charCodeAt(i);
			a = ((a * 33) ^ c) >>> 0;
			b = ((b * 31) + c) >>> 0;
		}
		return a.toString(36) + b.toString(36);
	},

	moreThumbs: function() {
		if (this.thumbsBusy || !window.PalmSystem) {
			return;
		}
		var items = [];
		while (this.thumbsAt < this.entries.length && items.length < 24) {
			var e = this.entries[this.thumbsAt++];
			if (e.hasPreview && !e.thumb) {
				e.key = this.thumbKey(e.path);
				if (!this.noThumb[e.key + e.etag]) {
					items.push({key: e.key, path: e.path, tag: e.etag});
				}
			}
		}
		if (!items.length) {
			return;
		}
		this.thumbsBusy = true;
		this.thumbsFor = this.loads;
		this.$.thumbsSvc.call({base: NC.api.baseUrl, user: NC.api.user, password: NC.api.password, items: items});
	},

	thumbsAnswer: function(inSender, inResponse) {
		this.thumbsBusy = false;
		if (this.thumbsFor !== this.loads) {
			return;  // another folder has been opened since
		}
		var files = (inResponse && inResponse.files) || {};
		var asked = (inResponse && inResponse.asked) || [];
		var i;
		// The server has no preview for some files; do not ask again this session.
		for (i = 0; i < asked.length; i++) {
			if (!files[asked[i]]) {
				this.noThumb[asked[i] + (inResponse.tags[asked[i]] || "")] = true;
			}
		}
		var any = false;
		for (i = 0; i < this.entries.length; i++) {
			var file = this.entries[i].key && files[this.entries[i].key];
			if (file) {
				this.entries[i].thumb = file;
				any = true;
			}
		}
		if (any) {
			this.$.list.refresh();
		}
		this.moreThumbs();
	},

	thumbsFailed: function() {
		this.thumbsBusy = false;
	},

	showNote: function(text) {
		this.$.note.setContent(String(text));
		this.$.note.setShowing(!!text);
	},

	// False at the top folder, so the App knows there was nowhere to go.
	goUp: function() {
		if (this.path === "/") {
			return false;
		}
		this.openFolder(NC.parent(this.path));
		return true;
	},

	// The short label drawn on a file's icon: its extension.
	extension: function(name) {
		var dot = name.lastIndexOf(".");
		if (dot <= 0 || name.length - dot > 5) {
			return "";
		}
		return name.substring(dot + 1).toUpperCase();
	},

	iconClass: function(entry) {
		if (entry.dir) {
			return "nc-icon nc-icon-folder";
		}
		var t = entry.type || "";
		if (/^image\//.test(t)) { return "nc-icon nc-icon-image"; }
		if (/^video\//.test(t)) { return "nc-icon nc-icon-video"; }
		if (/^audio\//.test(t)) { return "nc-icon nc-icon-audio"; }
		return "nc-icon nc-icon-file";
	},

	when: function(ms) {
		if (!ms) {
			return "";
		}
		var d = new Date(ms);
		var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
	},

	setupRow: function(inSender, inIndex) {
		var entry = this.entries[inIndex];
		if (!entry) {
			return false;
		}
		// The row's controls are reused for every row, so each one sets all of this.
		this.$.icon.setClassName(entry.thumb ? "nc-icon nc-icon-thumb" : this.iconClass(entry));
		this.$.icon.setContent(entry.dir || entry.thumb ? "" : String(this.extension(entry.name)));
		this.$.icon.applyStyle("background-image", entry.thumb ? "url(file://" + entry.thumb + ")" : null);
		this.$.name.setContent(String(entry.name));
		var parts = [];
		if (entry.dir) {
			parts.push("Folder");
		}
		if (entry.size !== null) {
			parts.push(NC.size(entry.size));
		}
		if (entry.modified) {
			parts.push(this.when(entry.modified));
		}
		this.$.info.setContent(parts.join(" · "));
		return true;
	},

	// ---- acting on a row -------------------------------------------------------

	rowClick: function(inSender, inEvent) {
		var entry = this.entries[inEvent.rowIndex];
		if (!entry) {
			return;
		}
		if (entry.dir) {
			this.openFolder(entry.path);
		} else {
			NC.transfers.download(entry, {open: true});
		}
	},

	moreClick: function(inSender, inEvent) {
		this.target = this.entries[inEvent.rowIndex];
		if (this.target) {
			this.$.menuDownload.setShowing(!this.target.dir);
			this.$.rowMenu.openAtEvent(inEvent);
		}
		return true;  // not a tap on the row itself
	},

	menuDownload: function() {
		if (this.target) {
			NC.transfers.download(this.target, {});
		}
	},

	menuRename: function() {
		if (this.target) {
			this.askName("rename", "Rename", this.target.name);
		}
	},

	menuDelete: function() {
		if (!this.target) {
			return;
		}
		this.$.confirmText.setContent("Delete " + String(this.target.name) +
			(this.target.dir ? " and everything in it" : "") + " from the server?");
		this.$.confirmDialog.openAtCenter();
	},

	confirmCancel: function() {
		this.$.confirmDialog.close();
	},

	confirmDelete: function() {
		this.$.confirmDialog.close();
		this.removeEntry(this.target.path);
	},

	removeEntry: function(path) {
		this.showNote("Deleting…");
		NC.api.remove(path, enyo.bind(this, function(ok, message) {
			if (ok) {
				this.reload(true);
			} else {
				this.showNote(message);
			}
		}));
	},

	// ---- new folder and rename, sharing one dialog --------------------------------

	newFolderClick: function() {
		this.askName("folder", "New Folder", "");
	},

	askName: function(purpose, caption, value) {
		this.namePurpose = purpose;
		this.$.nameDialog.setCaption(caption);
		this.$.nameMessage.setContent("");
		this.$.nameDialog.openAtCenter();
		this.$.nameInput.setValue(value);
		this.$.nameInput.forceFocus();
	},

	nameKey: function(inSender, inEvent) {
		if (inEvent.keyCode === 13) {
			this.nameOkClick();
		}
	},

	nameCancel: function() {
		this.$.nameDialog.close();
	},

	nameOkClick: function() {
		var name = this.$.nameInput.getValue().replace(/^\s+|\s+$/g, "");
		if (!name) {
			return;
		}
		if (/[\/\\]/.test(name)) {
			this.$.nameMessage.setContent("A name cannot contain a slash.");
			return;
		}
		var done = enyo.bind(this, function(ok, message) {
			this.$.nameOk.setDisabled(false);
			if (ok) {
				this.$.nameDialog.close();
				this.reload(true);
			} else {
				this.$.nameMessage.setContent(String(message));
			}
		});
		this.$.nameOk.setDisabled(true);
		if (this.namePurpose === "folder") {
			NC.api.makeFolder(NC.join(this.path, name), done);
		} else if (name === this.target.name) {
			done(true);
		} else {
			NC.api.move(this.target.path, NC.join(NC.parent(this.target.path), name), done);
		}
	},

	// ---- uploads ------------------------------------------------------------------

	uploadClick: function() {
		this.$.picker.pickFile();
	},

	filesPicked: function(inSender, inFiles) {
		var paths = [];
		for (var i = 0; inFiles && i < inFiles.length; i++) {
			if (inFiles[i].fullPath) {
				paths.push(inFiles[i].fullPath);
			}
		}
		NC.transfers.upload(paths, this.path);
	},

	// ---- what the transfers report ---------------------------------------------------

	transfersChanged: function() {
		var busy = NC.transfers.summary();
		var problem = NC.transfers.problemText;
		this.$.bar.setShowing(!!(busy || problem));
		this.$.barText.setContent(String(busy || problem));
		this.$.barButton.setCaption(busy ? "Cancel" : "OK");
		this.$.bar.addRemoveClass("nc-bar-problem", !busy && !!problem);
	},

	barButtonClick: function() {
		if (NC.transfers.summary()) {
			NC.transfers.cancelAll();
		} else {
			NC.transfers.clearProblem();
		}
	},

	transferFinished: function(job) {
		if (job.state !== "done") {
			return;
		}
		var d = job.details || {};
		if (d.kind === "upload" && d.folder === this.path) {
			this.reload(true);
		} else if (d.kind === "download" && d.open) {
			this.opening = job;
			this.$.openSvc.call({target: "file://" + job.local});
		}
	},

	openFailed: function() {
		var job = this.opening;
		NC.transfers.problemText = "No app on this TouchPad opens " + (job ? job.tag : "that file") +
			". It was saved in the Nextcloud folder.";
		this.transfersChanged();
	}
});
