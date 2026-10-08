/* Auto-upload settings: send new photos and videos from the TouchPad to a folder
 * on the server, on a schedule, whether or not the app is open.
 *
 * The work is done by our service's "sync" command (see service/transfer.js).
 * Calling it once runs it now and has it schedule itself from then on; the
 * settings and account travel with the schedule, so the app need not be running.
 * The choices are also kept in localStorage ("nc.auto") to fill this screen.
 */
enyo.kind({
	name: "NC.AutoUploadView",
	kind: enyo.VFlexBox,
	className: "nc-view",
	events: {
		onBack: ""
	},
	components: [
		{className: "nc-header", kind: "HFlexBox", align: "center", components: [
			{kind: "Button", caption: "Back", className: "nc-header-button", onclick: "backClick"},
			{kind: "VFlexBox", flex: 1, className: "nc-titles", components: [
				{className: "nc-title", content: "Auto-Upload"},
				{className: "nc-subtitle", content: "Photos and videos taken on this TouchPad"}
			]}
		]},
		{kind: "Scroller", flex: 1, components: [
			{className: "nc-settings-box", components: [
				{kind: "RowGroup", components: [
					{kind: "HFlexBox", align: "center", components: [
						{content: "Upload new photos and videos", flex: 1},
						{name: "on", kind: "ToggleButton", onChange: "changed"}
					]}
				]},
				{kind: "RowGroup", caption: "Folder on the server", components: [
					{name: "folder", kind: "Input", hint: "/Photos/TouchPad", autoCapitalize: "lowercase",
						autocorrect: false, spellcheck: false, onchange: "changed"}
				]},
				{kind: "RowGroup", components: [
					{kind: "HFlexBox", align: "center", components: [
						{content: "Include screenshots", flex: 1},
						{name: "screenshots", kind: "ToggleButton", onChange: "changed"}
					]},
					{kind: "HFlexBox", align: "center", components: [
						{content: "Only on Wi-Fi", flex: 1},
						{name: "wifiOnly", kind: "ToggleButton", onChange: "changed"}
					]}
				]},
				{name: "status", className: "nc-settings-status"},
				{name: "now", kind: "Button", caption: "Upload Now", onclick: "uploadNow"},
				{className: "nc-login-note", content: "Checks about every 15 minutes while the TouchPad is " +
					"awake and online. A file is sent once: deleting it on the server does not send it again."}
			]}
		]},
		{name: "syncSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "sync",
			onSuccess: "syncAnswer", onFailure: "syncFailed"},
		{name: "statusSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "syncStatus",
			onSuccess: "statusAnswer"},
		{name: "offSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "syncOff"}
	],

	create: function() {
		this.inherited(arguments);
		this.settings = {on: false, folder: "/Photos/TouchPad", screenshots: false, wifiOnly: true};
		try {
			enyo.mixin(this.settings, enyo.json.parse(localStorage.getItem("nc.auto") || "{}"));
		} catch (e) {}
	},

	// Fill the screen from the saved settings; called each time it is opened.
	load: function() {
		this.filling = true;
		this.$.on.setState(!!this.settings.on);
		this.$.folder.setValue(this.settings.folder);
		this.$.screenshots.setState(!!this.settings.screenshots);
		this.$.wifiOnly.setState(this.settings.wifiOnly !== false);
		this.filling = false;
		this.$.now.setDisabled(false);
		this.showStatus(null, false);
		if (window.PalmSystem) {
			this.$.statusSvc.call({});
		}
	},

	// "/Photos/TouchPad" from whatever was typed.
	tidyFolder: function(text) {
		var parts = String(text || "").split("/");
		var kept = [];
		for (var i = 0; i < parts.length; i++) {
			var p = parts[i].replace(/^\s+|\s+$/g, "");
			if (p && p !== "." && p !== "..") {
				kept.push(p);
			}
		}
		return kept.length ? "/" + kept.join("/") : "/Photos/TouchPad";
	},

	changed: function() {
		if (this.filling) {
			return;
		}
		this.settings.on = this.$.on.getState();
		this.settings.folder = this.tidyFolder(this.$.folder.getValue());
		this.settings.screenshots = this.$.screenshots.getState();
		this.settings.wifiOnly = this.$.wifiOnly.getState();
		localStorage.setItem("nc.auto", enyo.json.stringify(this.settings));
		this.apply();
	},

	params: function(again) {
		return {root: NC.api.baseUrl + NC.api.davRoot(), user: NC.api.user, password: NC.api.password,
			folder: this.settings.folder, screenshots: !!this.settings.screenshots,
			wifiOnly: this.settings.wifiOnly !== false, again: again};
	},

	// Put the saved settings into effect: (re)schedule, or stop.
	apply: function() {
		if (!window.PalmSystem || !NC.api.signedIn()) {
			return;
		}
		if (this.settings.on) {
			this.running = true;
			this.showStatus(null, true);
			this.$.syncSvc.call(this.params(true));
		} else {
			this.$.offSvc.call({});
		}
	},

	// Signing out: stop uploading for this account.
	turnOff: function() {
		this.settings.on = false;
		localStorage.setItem("nc.auto", enyo.json.stringify(this.settings));
		if (window.PalmSystem) {
			this.$.offSvc.call({});
		}
	},

	uploadNow: function() {
		this.changedFolder();
		this.running = true;
		this.$.now.setDisabled(true);
		this.showStatus(null, true);
		// When auto-upload is on, this run also renews the schedule.
		this.$.syncSvc.call(this.params(!!this.settings.on));
	},

	// The folder box only reports a change when it loses focus.
	changedFolder: function() {
		this.settings.folder = this.tidyFolder(this.$.folder.getValue());
		localStorage.setItem("nc.auto", enyo.json.stringify(this.settings));
	},

	syncAnswer: function(inSender, inResponse) {
		this.running = false;
		this.$.now.setDisabled(false);
		if (inResponse && inResponse.busy) {
			this.showStatus(null, true);
		} else {
			this.showStatus(inResponse && inResponse.status, false);
		}
	},

	syncFailed: function(inSender, inResponse) {
		this.running = false;
		this.$.now.setDisabled(false);
		NC.log("auto-upload: " + enyo.json.stringify(inResponse));
		this.$.status.setContent("The upload service did not answer.");
	},

	statusAnswer: function(inSender, inResponse) {
		if (!this.running) {
			this.showStatus(inResponse && inResponse.status, !!(inResponse && inResponse.running));
		}
	},

	showStatus: function(status, running) {
		var text = "";
		if (running) {
			text = "Uploading…";
		} else if (status) {
			var d = new Date(status.when);
			var minutes = d.getMinutes();
			var hours = d.getHours();
			var time = ((hours % 12) || 12) + ":" + (minutes < 10 ? "0" : "") + minutes + (hours < 12 ? " am" : " pm");
			var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
			text = "Last checked " + months[d.getMonth()] + " " + d.getDate() + " at " + time + ": ";
			if (status.error) {
				text += status.error;
			} else if (status.sent || status.failed) {
				text += status.sent + " sent" + (status.failed ? ", " + status.failed + " failed" : "") + ".";
			} else {
				text += "nothing new to send.";
			}
		}
		this.$.status.setContent(text);
	},

	backClick: function() {
		this.changedFolder();
		this.doBack();
	}
});
