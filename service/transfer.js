// File transfers for the Nextcloud app (node 0.4.12 on webOS 3 / webOS CE, ES5 only).
//
// A web app can neither write files to the TouchPad's storage nor read them to
// send. This service does both by running webOS CE's /usr/bin/curl, which also
// speaks the modern TLS that node's own https does not.
//
// The app hands over a list of jobs with "start" and then asks "status" about
// once a second while any are running, which also keeps the service awake (the
// service framework stops a service a while after its last call). "wait" answers
// only when every job has finished, so transfers carry on if the app is closed.

if (typeof require === "undefined") {
	require = IMPORTS.require;
}

var child_process = require("child_process");
var fs = require("fs");

var CURL = "/usr/bin/curl";
var MAX_RUNNING = 2;

var jobs = {};        // id -> job
var order = [];       // ids, oldest first
var running = 0;
var waiters = [];     // futures of "wait" calls

function log(msg) {
	try { console.log("[nctransfer] " + msg); } catch (e) {}
}

// A value inside double quotes in a curl config file.
function quote(value) {
	return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function describe(job) {
	return {id: job.id, kind: job.kind, state: job.state, percent: job.percent, error: job.error,
		local: job.local, tag: job.tag};
}

function activeCount() {
	var n = 0;
	for (var i = 0; i < order.length; i++) {
		var s = jobs[order[i]].state;
		if (s === "queued" || s === "running") {
			n++;
		}
	}
	return n;
}

function settle() {
	if (activeCount() > 0) {
		return;
	}
	var list = waiters;
	waiters = [];
	for (var i = 0; i < list.length; i++) {
		list[i].result = {returnValue: true};
	}
}

function finish(job, state, error) {
	if (job.state !== "running") {
		return;
	}
	job.state = state;
	job.error = error || "";
	job.child = null;
	job.password = "";
	running--;
	log(job.kind + " " + job.id + " " + state + (error ? ": " + error : ""));
	if (job.onEnd) {
		var onEnd = job.onEnd;
		job.onEnd = null;
		onEnd(job);
	}
	next();
	settle();
}

// What curl's exit code means, in words.
function curlProblem(code, text) {
	if (code === 22) {
		var m = /error: (\d\d\d)/.exec(text || "");
		var status = m ? m[1] : "";
		if (status === "401") { return "The server refused the user name or password."; }
		if (status === "403") { return "You do not have permission to do that."; }
		if (status === "404") { return "That file or folder is no longer there."; }
		if (status === "507") { return "The server is out of space."; }
		return "The server answered with an error" + (status ? " (" + status + ")." : ".");
	}
	if (code === 6 || code === 7 || code === 28 || code === 35 || code === 56) {
		return "The server could not be reached.";
	}
	if (code === 23) {
		return "The file could not be saved. The TouchPad may be out of space.";
	}
	if (code === 26) {
		return "The file could not be read.";
	}
	return "The transfer failed (curl " + code + ").";
}

function run(job) {
	job.state = "running";
	running++;
	var args = ["-f", "-#", "-K", "-", "--connect-timeout", "20"];
	var part = job.local + ".part";
	if (job.kind === "download") {
		args.push("--create-dirs", "-o", part, job.url);
	} else {
		args.push("-T", job.local, job.url);
	}
	var child;
	try {
		child = child_process.spawn(CURL, args);
	} catch (e) {
		finish(job, "failed", "curl could not be started.");
		return;
	}
	job.child = child;
	var errors = "";
	// The password goes in through stdin so it never shows in the process list.
	try {
		child.stdin.write("user = " + quote(job.user + ":" + job.password) + "\n");
		child.stdin.end();
	} catch (e2) {}
	child.stderr.on("data", function(data) {
		var text = data.toString();
		// The progress bar: "####   45.3%", redrawn in place.
		var all = text.match(/(\d+(?:\.\d+)?)%/g);
		if (all) {
			job.percent = Math.floor(parseFloat(all[all.length - 1]));
		}
		if (/curl: /.test(text)) {
			errors += text;
		}
	});
	child.on("exit", function(code) {
		if (job.cancelled) {
			if (job.kind === "download") {
				fs.unlink(part, function() {});
			}
			finish(job, "cancelled");
			return;
		}
		if (code !== 0) {
			if (job.kind === "download") {
				fs.unlink(part, function() {});
			}
			finish(job, "failed", curlProblem(code, errors));
			return;
		}
		if (job.kind !== "download") {
			job.percent = 100;
			finish(job, "done");
			return;
		}
		fs.rename(part, job.local, function(err) {
			job.percent = 100;
			if (err) {
				finish(job, "failed", "The file could not be saved.");
			} else {
				finish(job, "done");
			}
		});
	});
}

function next() {
	for (var i = 0; i < order.length && running < MAX_RUNNING; i++) {
		var job = jobs[order[i]];
		if (job.state === "queued") {
			run(job);
		}
	}
}

// ---- commands ---------------------------------------------------------------

// {user, password, jobs: [{id, kind: "download" | "upload", url, local, tag}]}
var startAssistant = function() {};
startAssistant.prototype.run = function(future) {
	var args = this.controller.args || {};
	var list = args.jobs || [];
	var added = 0;
	for (var i = 0; i < list.length; i++) {
		var j = list[i];
		if (!j || !j.id || !/^https?:\/\//i.test(j.url || "") || !/^\/media\/internal\//.test(j.local || "")
				|| /\/\.\.(\/|$)/.test(j.local) || (j.kind !== "download" && j.kind !== "upload")) {
			continue;
		}
		if (jobs[j.id] && (jobs[j.id].state === "queued" || jobs[j.id].state === "running")) {
			continue;
		}
		if (!jobs[j.id]) {
			order.push(j.id);
		}
		jobs[j.id] = {id: j.id, kind: j.kind, url: j.url, local: j.local, tag: j.tag || "",
			user: args.user || "", password: args.password || "",
			state: "queued", percent: 0, error: "", child: null, cancelled: false};
		added++;
	}
	next();
	future.result = {returnValue: true, added: added};
	return future;
};

// {forget: [ids]} drops finished jobs the app has dealt with.
var statusAssistant = function() {};
statusAssistant.prototype.run = function(future) {
	var args = this.controller.args || {};
	var forget = args.forget || [];
	var i;
	for (i = 0; i < forget.length; i++) {
		var job = jobs[forget[i]];
		if (job && job.state !== "queued" && job.state !== "running") {
			delete jobs[forget[i]];
		}
	}
	var kept = [];
	var out = [];
	for (i = 0; i < order.length; i++) {
		if (jobs[order[i]]) {
			kept.push(order[i]);
			out.push(describe(jobs[order[i]]));
		}
	}
	order = kept;
	future.result = {returnValue: true, jobs: out, active: activeCount()};
	return future;
};

// {id} stops one job; with no id, all of them.
var cancelAssistant = function() {};
cancelAssistant.prototype.run = function(future) {
	var args = this.controller.args || {};
	for (var i = 0; i < order.length; i++) {
		var job = jobs[order[i]];
		if (args.id && job.id !== args.id) {
			continue;
		}
		if (job.state === "queued") {
			job.state = "cancelled";
		} else if (job.state === "running") {
			job.cancelled = true;
			try { job.child.kill(); } catch (e) {}
		}
	}
	settle();
	future.result = {returnValue: true};
	return future;
};

// Answers when nothing is queued or running any more.
var waitAssistant = function() {};
waitAssistant.prototype.run = function(future) {
	waiters.push(future);
	settle();
	return future;
};

// ---- auto-upload --------------------------------------------------------------
//
// "sync" sends pictures and videos on the TouchPad that the server does not have
// yet. The app schedules it with the Activity Manager, which calls it with the
// account and settings as parameters (they are kept in the system's own database,
// not on the USB drive), so it runs with the app closed. A record of what has been
// sent lives in /media/internal/.nextcloud; a file is never sent twice, even if it
// is later deleted on the server.

var DATA_DIR = "/media/internal/.nextcloud";
var RECORD_FILE = DATA_DIR + "/uploaded.json";
var STATUS_FILE = DATA_DIR + "/status.json";
var ACTIVITY_NAME = "com.stark.nextcloud.autoupload";
var MEDIA = /\.(jpe?g|png|gif|bmp|mp4|m4v|3gp|3g2|mov)$/i;

var syncRunning = false;

function readJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (e) {
		return fallback;
	}
}

function writeJson(file, data) {
	try {
		try { fs.mkdirSync(DATA_DIR, 493 /* 0755 */); } catch (e) {}
		fs.writeFileSync(file, JSON.stringify(data));
	} catch (e2) {
		log("could not write " + file + ": " + e2);
	}
}

// Every picture and video under a folder: [{path, size}]
function scan(dir, out) {
	var names;
	try {
		names = fs.readdirSync(dir);
	} catch (e) {
		return out;
	}
	for (var i = 0; i < names.length; i++) {
		if (names[i].charAt(0) === ".") {
			continue;
		}
		var full = dir + "/" + names[i];
		var st;
		try {
			st = fs.statSync(full);
		} catch (e2) {
			continue;
		}
		if (st.isDirectory()) {
			scan(full, out);
		} else if (MEDIA.test(names[i]) && st.size > 0) {
			out.push({path: full, size: st.size});
		}
	}
	return out;
}

function encodePath(path) {
	var parts = path.split("/");
	for (var i = 0; i < parts.length; i++) {
		parts[i] = encodeURIComponent(parts[i]);
	}
	return parts.join("/");
}

function baseName(path) {
	return path.substring(path.lastIndexOf("/") + 1);
}

// A short request: callback(curl exit code, what the server sent).
function curlText(args, user, password, callback) {
	var child;
	var out = "";
	try {
		child = child_process.spawn(CURL, ["-s", "-K", "-", "--connect-timeout", "20", "--max-time", "120"].concat(args));
	} catch (e) {
		callback(-1, "");
		return;
	}
	try {
		child.stdin.write("user = " + quote(user + ":" + password) + "\n");
		child.stdin.end();
	} catch (e2) {}
	child.stdout.on("data", function(d) { out += d.toString(); });
	child.on("exit", function(code) { callback(code, out); });
}

// Make a folder and the folders above it: callback(ok).
function makeFolders(root, folder, user, password, callback) {
	var parts = folder.split("/").filter(function(p) { return p; });
	var at = 0;
	var path = "";
	function step() {
		if (at >= parts.length) {
			callback(true);
			return;
		}
		path += "/" + parts[at++];
		curlText(["-o", "/dev/null", "-w", "%{http_code}", "-X", "MKCOL", root + encodePath(path)], user, password,
			function(code, status) {
				// 201 made it; 405 says it was already there.
				if (code === 0 && (status === "201" || status === "405")) {
					step();
				} else {
					log("could not make folder " + path + ": curl " + code + ", status " + status);
					callback(false);
				}
			});
	}
	step();
}

// What a server folder holds: callback({name: size}) or callback(null).
function remoteFiles(root, folder, user, password, callback) {
	var body = "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:getcontentlength/></d:prop></d:propfind>";
	curlText(["-X", "PROPFIND", "-H", "Depth: 1", "-H", "Content-Type: application/xml", "--data", body,
		root + encodePath(folder) + "/"], user, password, function(code, text) {
			if (code !== 0 || !/multistatus/i.test(text)) {
				callback(null);
				return;
			}
			var found = {};
			var chunks = text.split(/<(?:[\w-]+:)?response[\s>]/i);
			for (var i = 1; i < chunks.length; i++) {
				var href = /<(?:[\w-]+:)?href>([^<]*)</i.exec(chunks[i]);
				var size = /<(?:[\w-]+:)?getcontentlength>(\d+)</i.exec(chunks[i]);
				if (href && size) {
					var name = href[1].replace(/\/+$/, "");
					name = name.substring(name.lastIndexOf("/") + 1);
					try { name = decodeURIComponent(name); } catch (e) {}
					found[name] = parseInt(size[1], 10);
				}
			}
			callback(found);
		});
}

// Ask the Activity Manager to call "sync" again later, with the same settings.
function schedule(settings, done) {
	var comms = IMPORTS.foundations.Comms || IMPORTS.foundations.comms;
	var requirements = {internet: true};
	if (settings.wifiOnly !== false) {
		requirements.wifi = true;
	}
	var future;
	try {
		future = comms.PalmCall.call("palm://com.palm.activitymanager/", "create", {
			activity: {
				name: ACTIVITY_NAME,
				description: "Nextcloud auto-upload",
				type: {background: true, persist: true, explicit: true},
				requirements: requirements,
				schedule: {interval: settings.interval || "15m"},
				callback: {method: "palm://com.stark.nextcloud.service/sync", params: settings}
			},
			start: true,
			replace: true
		});
	} catch (e) {
		log("could not schedule: " + e);
		done(false);
		return;
	}
	future.then(function(f) {
		var ok = false;
		try {
			ok = !!(f.result && f.result.returnValue !== false);
		} catch (e) {
			log("schedule failed: " + e);
		}
		done(ok);
	});
}

// {root, user, password, folder, screenshots, wifiOnly, interval, again}
//   root:   https://server/remote.php/dav/files/<account id>
//   folder: where on the server the files go, e.g. "/Photos/TouchPad"
//   again:  false for a one-off run that should not schedule the next one
var syncAssistant = function() {};
syncAssistant.prototype.run = function(future) {
	var args = this.controller.args || {};
	var settings = {root: args.root, user: args.user, password: args.password, folder: args.folder || "/Photos/TouchPad",
		screenshots: !!args.screenshots, wifiOnly: args.wifiOnly !== false, interval: args.interval || "15m"};
	var again = args.again !== false;

	function end(status) {
		syncRunning = false;
		status.when = new Date().getTime();
		writeJson(STATUS_FILE, status);
		log("auto-upload: " + JSON.stringify(status));
		function answer() {
			future.result = {returnValue: true, status: status};
		}
		if (again) {
			schedule(settings, answer);
		} else {
			answer();
		}
	}

	if (!/^https?:\/\//i.test(settings.root || "") || !settings.user) {
		future.result = {returnValue: false, errorText: "missing account"};
		return future;
	}
	if (syncRunning) {
		future.result = {returnValue: true, busy: true};
		return future;
	}
	syncRunning = true;

	var record = readJson(RECORD_FILE, {});
	var files = scan("/media/internal/DCIM", []);
	if (settings.screenshots) {
		scan("/media/internal/screencaptures", files);
	}
	var todo = [];
	for (var i = 0; i < files.length; i++) {
		var known = record[files[i].path];
		if (!known || known.size !== files[i].size) {
			todo.push(files[i]);
		}
	}
	if (!todo.length) {
		end({sent: 0, failed: 0, total: files.length});
		return future;
	}

	makeFolders(settings.root, settings.folder, settings.user, settings.password, function(ok) {
		if (!ok) {
			end({sent: 0, failed: 0, total: files.length,
				error: "The server could not be reached, or the folder could not be made."});
			return;
		}
		remoteFiles(settings.root, settings.folder, settings.user, settings.password, function(remote) {
			if (!remote) {
				end({sent: 0, failed: 0, total: files.length, error: "The server folder could not be read."});
				return;
			}
			var sent = 0;
			var failed = 0;
			var left = 0;
			function one(file) {
				return function(job) {
					if (job.state === "done") {
						record[file.path] = {size: file.size};
						sent++;
						writeJson(RECORD_FILE, record);
					} else {
						failed++;
					}
					left--;
					if (left === 0) {
						end({sent: sent, failed: failed, total: files.length});
					}
				};
			}
			for (var k = 0; k < todo.length; k++) {
				var name = baseName(todo[k].path);
				if (remote[name] === todo[k].size) {
					// Already there (an earlier run, or another device's copy).
					record[todo[k].path] = {size: todo[k].size};
					continue;
				}
				var id = "a" + new Date().getTime().toString(36) + k;
				order.push(id);
				jobs[id] = {id: id, kind: "upload",
					url: settings.root + encodePath(settings.folder) + "/" + encodeURIComponent(name),
					local: todo[k].path, tag: name, user: settings.user, password: settings.password,
					state: "queued", percent: 0, error: "", child: null, cancelled: false,
					onEnd: one(todo[k])};
				left++;
			}
			writeJson(RECORD_FILE, record);
			if (left === 0) {
				end({sent: 0, failed: 0, total: files.length});
			} else {
				next();
			}
		});
	});
	return future;
};

// When auto-upload last ran and what it did, and whether it is running now.
var syncStatusAssistant = function() {};
syncStatusAssistant.prototype.run = function(future) {
	future.result = {returnValue: true, status: readJson(STATUS_FILE, null), running: syncRunning};
	return future;
};

// Turns the schedule off. The Activity Manager only lets an activity's creator
// (this service) cancel it, so the app has to ask.
var syncOffAssistant = function() {};
syncOffAssistant.prototype.run = function(future) {
	var comms = IMPORTS.foundations.Comms || IMPORTS.foundations.comms;
	var call;
	try {
		call = comms.PalmCall.call("palm://com.palm.activitymanager/", "cancel", {activityName: ACTIVITY_NAME});
	} catch (e) {
		future.result = {returnValue: false, errorText: String(e)};
		return future;
	}
	call.then(function(f) {
		try {
			var r = f.result;
		} catch (e) {
			// Nothing was scheduled: that is what was wanted.
		}
		future.result = {returnValue: true};
	});
	return future;
};

// ---- thumbnails ----------------------------------------------------------------
//
// A web page cannot send the sign-in along with an <img> request, so the app asks
// for the server's previews here; they are fetched with curl and kept in
// /media/internal/.nextcloud/thumbs, named by a key the app gives and the version.

var THUMB_DIR = DATA_DIR + "/thumbs";
var THUMBS_AT_ONCE = 3;

// {base, user, password, items: [{key, path, tag}]}
//   base: https://server
//   key:  letters and digits naming the file      path: the file's path on the server
//   tag:  the file's etag, so a changed file gets a new picture
// Answers {files: {key: local path}} for the ones that could be had, with
// {asked: [key], tags: {key: tag}} so the app can tell which could not.
var thumbsAssistant = function() {};
thumbsAssistant.prototype.run = function(future) {
	var args = this.controller.args || {};
	var items = (args.items || []).slice(0, 40);
	var files = {};
	var at = 0;
	var busy = 0;
	var answered = false;

	if (!/^https?:\/\//i.test(args.base || "")) {
		future.result = {returnValue: false, errorText: "missing server"};
		return future;
	}
	try { fs.mkdirSync(DATA_DIR, 493); } catch (e) {}
	try { fs.mkdirSync(THUMB_DIR, 493); } catch (e2) {}

	function pump() {
		while (busy < THUMBS_AT_ONCE && at < items.length) {
			fetch(items[at++]);
		}
		if (busy === 0 && at >= items.length && !answered) {
			answered = true;
			var asked = [];
			var tags = {};
			for (var i = 0; i < items.length; i++) {
				asked.push(items[i].key);
				tags[items[i].key] = items[i].tag;
			}
			future.result = {returnValue: true, files: files, asked: asked, tags: tags};
		}
	}

	function fetch(item) {
		var id = String(item.key || "").replace(/[^0-9A-Za-z]/g, "");
		var tag = String(item.tag || "").replace(/[^0-9A-Za-z]/g, "").substring(0, 16);
		if (!id || !item.path) {
			return;
		}
		var file = THUMB_DIR + "/" + id + "-" + tag + ".jpg";
		try {
			if (fs.statSync(file).size > 0) {
				files[item.key] = file;
				return;
			}
		} catch (e) {}
		busy++;
		var child;
		try {
			child = child_process.spawn(CURL, ["-f", "-s", "-K", "-", "--connect-timeout", "15", "--max-time", "40",
				"-o", file + ".part", args.base + "/index.php/core/preview.png?file=" + encodeURIComponent(item.path) + "&x=128&y=128&a=0"]);
		} catch (e2) {
			busy--;
			return;
		}
		try {
			child.stdin.write("user = " + quote((args.user || "") + ":" + (args.password || "")) + "\n");
			child.stdin.end();
		} catch (e3) {}
		child.on("exit", function(code) {
			function done() {
				busy--;
				pump();
			}
			if (code !== 0) {
				fs.unlink(file + ".part", function() { done(); });
				return;
			}
			fs.rename(file + ".part", file, function(err) {
				if (!err) {
					files[item.key] = file;
				}
				done();
			});
		});
	}

	pump();
	return future;
};
