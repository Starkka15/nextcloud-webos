/* Downloads and uploads, carried out by our service (com.stark.nextcloud.service).
 *
 * Downloads are saved under /media/internal/Nextcloud in the same folders as on
 * the server, so they also show up over USB and in other apps. The App owns one
 * of these and makes it available as NC.transfers.
 */
enyo.kind({
	name: "NC.Transfers",
	kind: enyo.Component,
	folder: "/media/internal/Nextcloud",
	events: {
		// Something to show changed: a job started, moved on or ended.
		onChanged: "",
		// One job ended: (job) with state "done", "failed" or "cancelled".
		onFinished: ""
	},
	components: [
		{name: "startSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "start",
			onSuccess: "started", onFailure: "serviceFailed"},
		{name: "statusSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "status",
			onSuccess: "statusAnswer", onFailure: "serviceFailed"},
		{name: "cancelSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "cancel"},
		{name: "waitSvc", kind: "PalmService", service: "palm://com.stark.nextcloud.service/", method: "wait"}
	],

	create: function() {
		this.inherited(arguments);
		this.jobs = [];      // as the service last reported them
		this.details = {};   // id -> what the app knows about the job
		this.counter = 0;
		this.problemText = "";
	},

	// Pick up transfers that were running when the app was last closed.
	restore: function() {
		if (window.PalmSystem) {
			this.$.statusSvc.call({});
		}
	},

	newId: function(prefix) {
		this.counter++;
		return prefix + new Date().getTime().toString(36) + this.counter;
	},

	localPath: function(path) {
		return this.folder + path;
	},

	// options.open: open the file with its app when it has arrived.
	download: function(entry, options) {
		var id = this.newId("d");
		this.details[id] = {kind: "download", entry: entry, open: !!(options && options.open)};
		this.begin([{id: id, kind: "download", url: NC.api.fileUrl(entry.path),
			local: this.localPath(entry.path), tag: entry.name}]);
	},

	// localFiles: paths on the TouchPad; they go into remoteFolder under their own names.
	upload: function(localFiles, remoteFolder) {
		var list = [];
		for (var i = 0; i < localFiles.length; i++) {
			var name = NC.baseName(localFiles[i]);
			var id = this.newId("u");
			this.details[id] = {kind: "upload", folder: remoteFolder, name: name};
			list.push({id: id, kind: "upload", url: NC.api.fileUrl(NC.join(remoteFolder, name)),
				local: localFiles[i], tag: name});
		}
		if (list.length) {
			this.begin(list);
		}
	},

	begin: function(list) {
		this.problemText = "";
		for (var i = 0; i < list.length; i++) {
			this.jobs.push({id: list[i].id, kind: list[i].kind, tag: list[i].tag, state: "queued", percent: 0});
		}
		this.doChanged();
		this.$.startSvc.call({user: NC.api.user, password: NC.api.password, jobs: list});
	},

	started: function() {
		// Lets the transfers run on if the app is closed.
		this.$.waitSvc.call({});
		this.poll();
	},

	serviceFailed: function(inSender, inResponse) {
		NC.log("transfer service: " + enyo.json.stringify(inResponse));
		this.problemText = "The transfer service did not answer.";
		this.jobs = [];
		this.doChanged();
	},

	poll: function() {
		clearTimeout(this.timer);
		this.timer = setTimeout(enyo.bind(this, function() {
			this.$.statusSvc.call({forget: this.forget || []});
			this.forget = [];
		}), 1000);
	},

	statusAnswer: function(inSender, inResponse) {
		var list = (inResponse && inResponse.jobs) || [];
		var active = [];
		this.forget = this.forget || [];
		for (var i = 0; i < list.length; i++) {
			var job = list[i];
			if (job.state === "queued" || job.state === "running") {
				active.push(job);
				continue;
			}
			// Ended: tell whoever cares, once, then have the service drop it.
			this.forget.push(job.id);
			job.details = this.details[job.id] || {};
			delete this.details[job.id];
			if (job.state === "failed") {
				this.problemText = (job.kind === "upload" ? "Could not upload " : "Could not download ") +
					job.tag + ". " + job.error;
			}
			this.doFinished(job);
		}
		this.jobs = active;
		this.doChanged();
		if (active.length || this.forget.length) {
			this.poll();
		}
	},

	cancelAll: function() {
		this.$.cancelSvc.call({});
	},

	clearProblem: function() {
		this.problemText = "";
		this.doChanged();
	},

	// One line for the bar at the bottom of the screen, or "" when idle.
	summary: function() {
		if (!this.jobs.length) {
			return "";
		}
		var current = this.jobs[0];
		for (var i = 0; i < this.jobs.length; i++) {
			if (this.jobs[i].state === "running") {
				current = this.jobs[i];
				break;
			}
		}
		var text = (current.kind === "upload" ? "Uploading " : "Downloading ") + current.tag;
		if (current.state === "running") {
			text += " — " + (current.percent || 0) + "%";
		}
		if (this.jobs.length > 1) {
			text += " (" + (this.jobs.length - 1) + " more)";
		}
		return text;
	}
});
