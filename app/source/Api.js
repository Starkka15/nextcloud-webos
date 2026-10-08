/* Talks to the Nextcloud server: sign-in and WebDAV file operations.
 * (webOS 3 WebKit: ES5 only.)
 *
 * Paths are plain text and start with "/": "/" is the top of the user's files,
 * "/Photos/2024" a folder in it. They are encoded only when a request is made.
 */
var NC = window.NC || {};

NC.log = function(msg) {
	try { console.log("[nextcloud] " + msg); } catch (e) {}
};

// "1.4 MB"
NC.size = function(bytes) {
	if (bytes === undefined || bytes === null || isNaN(bytes)) {
		return "";
	}
	var units = ["bytes", "KB", "MB", "GB", "TB"];
	var n = bytes;
	var u = 0;
	while (n >= 1024 && u < units.length - 1) {
		n /= 1024;
		u++;
	}
	return (u === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + units[u];
};

// "/a/b/c.txt" -> "/a/b"; the parent of "/" is "/".
NC.parent = function(path) {
	var i = path.replace(/\/+$/, "").lastIndexOf("/");
	return i <= 0 ? "/" : path.substring(0, i);
};

NC.baseName = function(path) {
	var p = path.replace(/\/+$/, "");
	return p.substring(p.lastIndexOf("/") + 1);
};

NC.join = function(folder, name) {
	return (folder === "/" ? "" : folder) + "/" + name;
};

NC.api = {
	baseUrl: "",      // https://cloud.example.com, no trailing slash
	user: "",         // what was typed at sign-in
	userId: "",       // the server's id for the account (it names the files folder)
	displayName: "",
	password: "",     // an app password, ideally

	restore: function() {
		this.baseUrl = localStorage.getItem("nc.url") || "";
		this.user = localStorage.getItem("nc.user") || "";
		this.userId = localStorage.getItem("nc.userId") || "";
		this.displayName = localStorage.getItem("nc.displayName") || "";
		this.password = localStorage.getItem("nc.password") || "";
		return this.signedIn();
	},

	save: function() {
		localStorage.setItem("nc.url", this.baseUrl);
		localStorage.setItem("nc.user", this.user);
		localStorage.setItem("nc.userId", this.userId);
		localStorage.setItem("nc.displayName", this.displayName);
		localStorage.setItem("nc.password", this.password);
	},

	signedIn: function() {
		return !!(this.baseUrl && this.userId && this.password);
	},

	signOut: function() {
		this.password = "";
		this.userId = "";
		localStorage.removeItem("nc.password");
		localStorage.removeItem("nc.userId");
	},

	authHeader: function() {
		// btoa takes Latin-1; send other characters as UTF-8 bytes.
		return "Basic " + btoa(unescape(encodeURIComponent(this.user + ":" + this.password)));
	},

	encodePath: function(path) {
		var parts = path.split("/");
		for (var i = 0; i < parts.length; i++) {
			parts[i] = encodeURIComponent(parts[i]);
		}
		return parts.join("/");
	},

	// Where the account's files live on the server, without a trailing slash.
	davRoot: function() {
		return "/remote.php/dav/files/" + encodeURIComponent(this.userId);
	},

	// The full address of a file or folder.
	fileUrl: function(path) {
		return this.baseUrl + this.davRoot() + this.encodePath(path === "/" ? "" : path);
	},

	// callback(status, request); status 0 means the server could not be reached.
	request: function(method, url, options, callback) {
		options = options || {};
		var req = new XMLHttpRequest();
		var done = false;
		var timer = null;
		function finish(status) {
			if (done) {
				return;
			}
			done = true;
			clearTimeout(timer);
			callback(status, req);
		}
		try {
			req.open(method, url, true);
			req.setRequestHeader("Authorization", this.authHeader());
			var headers = options.headers || {};
			for (var h in headers) {
				req.setRequestHeader(h, headers[h]);
			}
		} catch (e) {
			NC.log("request could not be opened: " + e);
			setTimeout(function() { finish(0); }, 0);
			return;
		}
		req.onreadystatechange = function() {
			if (req.readyState === 4) {
				finish(req.status || 0);
			}
		};
		timer = setTimeout(function() {
			try { req.abort(); } catch (e) {}
			finish(0);
		}, options.timeout || 30000);
		req.send(options.body || null);
	},

	// A sentence for a failed request.
	problem: function(status) {
		if (status === 0) {
			return "The server could not be reached.";
		}
		if (status === 401) {
			return "The server refused the user name or password.";
		}
		if (status === 403) {
			return "You do not have permission to do that.";
		}
		if (status === 404) {
			return "That file or folder is no longer there.";
		}
		if (status === 405 || status === 412) {
			return "Something with that name already exists.";
		}
		if (status === 423) {
			return "That file is locked.";
		}
		if (status === 507) {
			return "The server is out of space.";
		}
		return "The server answered with an error (" + status + ").";
	},

	// "cloud.example.com/index.php/apps/files" -> "https://cloud.example.com"
	tidyUrl: function(url) {
		url = String(url || "").replace(/^\s+|\s+$/g, "");
		if (!url) {
			return "";
		}
		if (!/^https?:\/\//i.test(url)) {
			url = "https://" + url;
		}
		return url.replace(/\/(index\.php|remote\.php|apps|login)(\/.*)?$/i, "").replace(/\/+$/, "");
	},

	// callback(ok, message)
	signIn: function(url, user, password, callback) {
		var self = this;
		this.baseUrl = this.tidyUrl(url);
		this.user = user;
		this.password = password;
		this.userId = "";
		this.displayName = "";
		// Nextcloud tells us the account's real id; a login name or e-mail
		// address may differ from it.
		this.request("GET", this.baseUrl + "/ocs/v2.php/cloud/user?format=json",
			{headers: {"OCS-APIRequest": "true", "Accept": "application/json"}},
			function(status, req) {
				if (status === 401) {
					callback(false, self.problem(401));
					return;
				}
				if (status === 0) {
					callback(false, self.problem(0));
					return;
				}
				if (status === 200) {
					try {
						var data = enyo.json.parse(req.responseText).ocs.data;
						self.userId = data.id;
						self.displayName = data["display-name"] || data.displayname || data.id;
					} catch (e) {}
				}
				if (!self.userId) {
					// Not a Nextcloud answer (another WebDAV server, perhaps): go by the name.
					self.userId = user;
					self.displayName = user;
				}
				self.list("/", function(ok, result) {
					if (ok) {
						self.save();
						callback(true);
					} else {
						self.userId = "";
						callback(false, result);
					}
				});
			});
	},

	propfindBody: '<?xml version="1.0"?>' +
		'<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:prop>' +
		'<d:getlastmodified/><d:getcontentlength/><d:getcontenttype/><d:resourcetype/><d:getetag/>' +
		'<oc:fileid/><oc:size/><oc:permissions/><oc:favorite/><nc:has-preview/>' +
		'</d:prop></d:propfind>',

	// The TouchPad's web engine sends no body with a PROPFIND, so the server never
	// sees the list of properties above and answers with its default set. That set
	// has what the list needs (name, size, date, type, etag) but not the file id.
	//
	// The contents of a folder: callback(true, [entry]) or callback(false, message).
	// entry: {name, path, dir, size, modified (ms), type, id, etag, hasPreview, favorite}
	list: function(path, callback) {
		var self = this;
		var url = this.fileUrl(path) + "/";
		this.request("PROPFIND", url, {
			headers: {"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
			body: this.propfindBody
		}, function(status, req) {
			if (status !== 207) {
				callback(false, self.problem(status));
				return;
			}
			var doc = req.responseXML;
			if (!doc || !doc.documentElement) {
				try {
					doc = new DOMParser().parseFromString(req.responseText, "text/xml");
				} catch (e) {
					doc = null;
				}
			}
			if (!doc) {
				callback(false, "The server's answer could not be read.");
				return;
			}
			callback(true, self.parseListing(doc, path));
		});
	},

	parseListing: function(doc, folder) {
		var DAV = "DAV:";
		var OC = "http://owncloud.org/ns";
		var NCNS = "http://nextcloud.org/ns";
		function text(node, ns, name) {
			var found = node.getElementsByTagNameNS(ns, name);
			return found.length ? (found[0].textContent || "") : "";
		}
		var root = decodeURIComponent(this.davRoot());
		var out = [];
		var responses = doc.getElementsByTagNameNS(DAV, "response");
		for (var i = 0; i < responses.length; i++) {
			var r = responses[i];
			var href = text(r, DAV, "href");
			try {
				href = decodeURIComponent(href);
			} catch (e) {}
			// An href may be a whole address or only its path.
			href = href.replace(/^https?:\/\/[^\/]+/i, "");
			var at = href.indexOf(root);
			var p = at >= 0 ? href.substring(at + root.length) : href;
			p = p.replace(/\/+$/, "") || "/";
			if (p === (folder.replace(/\/+$/, "") || "/")) {
				continue;  // the folder itself
			}
			// Take the properties the server did have (the 200 block).
			var props = null;
			var stats = r.getElementsByTagNameNS(DAV, "propstat");
			for (var j = 0; j < stats.length; j++) {
				if (/ 200 /.test(text(stats[j], DAV, "status")) || stats.length === 1) {
					props = stats[j];
					break;
				}
			}
			if (!props) {
				continue;
			}
			var type = props.getElementsByTagNameNS(DAV, "resourcetype");
			var dir = type.length > 0 && type[0].getElementsByTagNameNS(DAV, "collection").length > 0;
			var size = parseInt(text(props, dir ? OC : DAV, dir ? "size" : "getcontentlength"), 10);
			out.push({
				name: NC.baseName(p),
				path: p,
				dir: dir,
				size: isNaN(size) ? null : size,
				modified: Date.parse(text(props, DAV, "getlastmodified")) || 0,
				type: text(props, DAV, "getcontenttype"),
				id: text(props, OC, "fileid"),
				etag: text(props, DAV, "getetag"),
				hasPreview: !dir && /^(image|video)\//.test(text(props, DAV, "getcontenttype")),
				favorite: text(props, OC, "favorite") === "1"
			});
		}
		out.sort(function(a, b) {
			if (a.dir !== b.dir) {
				return a.dir ? -1 : 1;
			}
			var x = a.name.toLowerCase();
			var y = b.name.toLowerCase();
			return x < y ? -1 : (x > y ? 1 : 0);
		});
		return out;
	},

	// The three below: callback(ok, message).
	makeFolder: function(path, callback) {
		var self = this;
		this.request("MKCOL", this.fileUrl(path), {}, function(status) {
			callback(status === 201, status === 201 ? "" : self.problem(status));
		});
	},

	remove: function(path, callback) {
		var self = this;
		this.request("DELETE", this.fileUrl(path), {timeout: 120000}, function(status) {
			var ok = status === 204 || status === 200;
			callback(ok, ok ? "" : self.problem(status));
		});
	},

	move: function(from, to, callback) {
		var self = this;
		this.request("MOVE", this.fileUrl(from), {
			headers: {"Destination": this.fileUrl(to), "Overwrite": "F"},
			timeout: 120000
		}, function(status) {
			var ok = status === 201 || status === 204;
			callback(ok, ok ? "" : self.problem(status));
		});
	}
};
