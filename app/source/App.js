/* The app: the sign-in screen or the file browser. */
enyo.kind({
	name: "NC.App",
	kind: enyo.VFlexBox,
	className: "nc-app",
	components: [
		{kind: "ApplicationEvents", onBack: "backGesture", onWindowParamsChange: "windowParamsChanged"},
		{name: "pane", kind: "Pane", flex: 1, transitionKind: "enyo.transitions.Simple", components: [
			{name: "login", kind: "NC.LoginView", onSignedIn: "signedIn"},
			{name: "files", kind: "NC.FilesView"},
			{name: "auto", kind: "NC.AutoUploadView", onBack: "closeAuto"}
		]},
		{name: "transfers", kind: "NC.Transfers", onChanged: "transfersChanged", onFinished: "transferFinished"},
		// Under the app's name, top left.
		{kind: "AppMenu", components: [
			{caption: "Refresh", onclick: "refreshClick"},
			{caption: "Auto-Upload", onclick: "openAuto"},
			{caption: "Sign Out", onclick: "signOut"}
		]}
	],

	create: function() {
		this.inherited(arguments);
		NC.transfers = this.$.transfers;
	},

	rendered: function() {
		this.inherited(arguments);
		if (this.begun) {
			return;
		}
		this.begun = true;
		var params = enyo.windowParams || {};
		if (params.signIn) {
			this.testLaunch(params);
		} else if (NC.api.restore()) {
			this.showFiles();
			this.testLaunch(params);
		} else {
			this.$.pane.selectViewByName("login");
		}
	},

	showFiles: function(path) {
		this.$.pane.selectViewByName("files");
		this.$.files.openFolder(path || "/");
		this.$.transfers.restore();
	},

	signedIn: function() {
		this.showFiles();
	},

	openAuto: function() {
		if (NC.api.signedIn()) {
			this.$.pane.selectViewByName("auto");
			this.$.auto.load();
		}
	},

	closeAuto: function() {
		this.$.pane.selectViewByName("files");
	},

	signOut: function() {
		this.$.transfers.cancelAll();
		this.$.auto.turnOff();
		NC.api.signOut();
		this.$.pane.selectViewByName("login");
	},

	refreshClick: function() {
		if (NC.api.signedIn()) {
			this.$.files.reload(true);
		}
	},

	backGesture: function(inSender, inEvent) {
		var view = this.$.pane.getViewName();
		if (view === "auto") {
			this.closeAuto();
		} else if (view !== "files" || !this.$.files.goUp()) {
			return;
		}
		inEvent.preventDefault();
		return true;
	},

	transfersChanged: function() {
		this.$.files.transfersChanged();
	},

	transferFinished: function(inSender, job) {
		this.$.files.transferFinished(job);
	},

	windowParamsChanged: function() {
		this.testLaunch(enyo.windowParams || {});
	},

	// For testing from a PC, with no one tapping the screen:
	//   luna-send -n 1 palm://com.palm.applicationManager/launch
	//       '{"id":"com.stark.nextcloud","params":{"path":"/Photos"}}'
	// {signIn: {url, user, password}} signs in first; then any one of
	// {path}, {download: path}, {upload: [local paths], to: folder},
	// {mkdir: path}, {remove: path}, {rename: {from, to}}, {auto: true} (the
	// auto-upload screen). {signOut: true} signs out.
	testLaunch: function(params) {
		var self = this;
		if (params.signOut) {
			this.signOut();
			return;
		}
		if (params.signIn) {
			var s = params.signIn;
			delete params.signIn;
			NC.api.signIn(s.url, s.user, s.password, function(ok, message) {
				NC.log("test sign-in: " + (ok ? "ok as " + NC.api.userId : message));
				if (ok) {
					self.showFiles(params.path);
					self.testLaunch(params);
				} else {
					self.$.pane.selectViewByName("login");
				}
			});
			return;
		}
		if (!NC.api.signedIn()) {
			return;
		}
		function report(what) {
			return function(ok, message) {
				NC.log("test " + what + ": " + (ok ? "ok" : message));
				self.$.files.reload(true);
			};
		}
		if (params.auto) {
			this.openAuto();
		}
		if (params.path) {
			this.$.files.openFolder(params.path);
		}
		if (params.download) {
			NC.transfers.download({path: params.download, name: NC.baseName(params.download)}, {open: !!params.open});
		}
		if (params.upload) {
			NC.transfers.upload(params.upload, params.to || "/");
		}
		if (params.mkdir) {
			NC.api.makeFolder(params.mkdir, report("mkdir"));
		}
		if (params.remove) {
			NC.api.remove(params.remove, report("remove"));
		}
		if (params.rename) {
			NC.api.move(params.rename.from, params.rename.to, report("rename"));
		}
	}
});
