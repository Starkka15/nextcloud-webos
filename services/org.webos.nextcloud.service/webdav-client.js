// WebDAV client for Nextcloud using built-in Node.js http/https
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');

// Manual URL parsing for old Node.js compatibility
function parseUrl(urlStr) {
    var result = {
        protocol: 'http:',
        hostname: '',
        port: null,
        path: '/'
    };

    // Extract protocol
    var protoEnd = urlStr.indexOf('://');
    if (protoEnd !== -1) {
        result.protocol = urlStr.substring(0, protoEnd + 1);
        urlStr = urlStr.substring(protoEnd + 3);
    }

    // Extract path
    var pathStart = urlStr.indexOf('/');
    if (pathStart !== -1) {
        result.path = urlStr.substring(pathStart);
        urlStr = urlStr.substring(0, pathStart);
    }

    // Extract port
    var portStart = urlStr.indexOf(':');
    if (portStart !== -1) {
        result.port = parseInt(urlStr.substring(portStart + 1), 10);
        result.hostname = urlStr.substring(0, portStart);
    } else {
        result.hostname = urlStr;
    }

    return result;
}

function WebDAVClient(config) {
    this.serverUrl = config.serverUrl;
    this.username = config.username;
    this.password = config.password;
}

WebDAVClient.prototype.buildUrl = function(remotePath) {
    // Build Nextcloud WebDAV URL
    // Format: https://server/remote.php/dav/files/USERNAME/path
    if (!this.serverUrl) {
        console.error('WebDAV: No server URL configured');
        return null;
    }

    var base = this.serverUrl.replace(/\/$/, '');
    var encodedUser = encodeURIComponent(this.username);
    var encodedPath = remotePath.split('/').map(function(part) {
        return encodeURIComponent(part);
    }).join('/');

    var fullUrl = base + '/remote.php/dav/files/' + encodedUser + encodedPath;
    console.log('WebDAV URL: ' + fullUrl);
    return fullUrl;
};

WebDAVClient.prototype.request = function(method, remotePath, options, callback) {
    var self = this;
    var fullUrl = this.buildUrl(remotePath);

    if (!fullUrl) {
        callback(new Error('Invalid URL - server not configured'), null, null);
        return;
    }

    var parsed = parseUrl(fullUrl);
    var isHttps = parsed.protocol === 'https:';
    var lib = isHttps ? https : http;

    console.log('[WebDAV] ' + method + ' ' + fullUrl);
    console.log('[WebDAV] parsed.hostname=' + parsed.hostname + ' parsed.port=' + parsed.port + ' parsed.path=' + parsed.path);

    // Build Basic auth header manually for old Node.js compatibility
    var authString = this.username + ':' + this.password;
    var authBase64 = new Buffer(authString).toString('base64');

    var headers = options.headers || {};
    headers['Authorization'] = 'Basic ' + authBase64;

    var reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path,
        method: method,
        headers: headers
    };

    var req = lib.request(reqOptions, function(res) {
        var chunks = [];

        res.on('data', function(chunk) {
            chunks.push(chunk);
        });

        res.on('end', function() {
            var body = Buffer.concat(chunks).toString('utf8');
            callback(null, res.statusCode, body);
        });
    });

    req.on('error', function(err) {
        callback(err, null, null);
    });

    if (options.body) {
        req.write(options.body);
    }

    req.end();
};

WebDAVClient.prototype.testConnection = function(callback) {
    var self = this;

    this.request('PROPFIND', '/', {
        headers: {
            'Depth': '0',
            'Content-Type': 'application/xml'
        }
    }, function(err, statusCode, body) {
        if (err) {
            callback(err);
            return;
        }

        if (statusCode === 401) {
            callback(new Error('Authentication failed'));
            return;
        }

        if (statusCode >= 200 && statusCode < 300) {
            callback(null);
        } else {
            callback(new Error('Server error: HTTP ' + statusCode));
        }
    });
};

WebDAVClient.prototype.uploadFile = function(localPath, remotePath, progressCallback, callback) {
    var self = this;

    // Read file
    var fileSize;
    try {
        var stats = fs.statSync(localPath);
        fileSize = stats.size;
    } catch (e) {
        callback(new Error('Cannot read file: ' + e.message));
        return;
    }

    var fullUrl = this.buildUrl(remotePath);
    if (!fullUrl) {
        callback(new Error('Invalid URL - server not configured'));
        return;
    }

    var parsed = parseUrl(fullUrl);
    var isHttps = parsed.protocol === 'https:';
    var lib = isHttps ? https : http;

    console.log('[WebDAV] PUT ' + fullUrl);
    console.log('[WebDAV] parsed.hostname=' + parsed.hostname + ' parsed.port=' + parsed.port + ' parsed.path=' + parsed.path);

    // Build Basic auth header manually for old Node.js compatibility
    var authString = this.username + ':' + this.password;
    var authBase64 = new Buffer(authString).toString('base64');

    var reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path,
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileSize,
            'Authorization': 'Basic ' + authBase64
        }
    };

    var req = lib.request(reqOptions, function(res) {
        var chunks = [];

        res.on('data', function(chunk) {
            chunks.push(chunk);
        });

        res.on('end', function() {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                callback(null);
            } else {
                callback(new Error('Upload failed: HTTP ' + res.statusCode));
            }
        });
    });

    req.on('error', function(err) {
        callback(err);
    });

    // Stream file to request
    var readStream = fs.createReadStream(localPath);
    var uploaded = 0;

    readStream.on('data', function(chunk) {
        uploaded += chunk.length;
        if (progressCallback) {
            progressCallback(uploaded, fileSize);
        }
    });

    readStream.on('error', function(err) {
        req.abort();
        callback(err);
    });

    readStream.pipe(req);
};

WebDAVClient.prototype.createDirectory = function(remotePath, callback) {
    this.request('MKCOL', remotePath, {}, function(err, statusCode, body) {
        if (err) {
            callback(err);
            return;
        }

        // 201 = Created, 405 = Already exists (both are OK)
        if (statusCode === 201 || statusCode === 405 || statusCode === 301) {
            callback(null);
        } else {
            callback(new Error('Failed to create directory: HTTP ' + statusCode));
        }
    });
};

WebDAVClient.prototype.ensureDirectoryExists = function(remotePath, callback) {
    var self = this;
    var parts = remotePath.split('/').filter(function(p) { return p; });
    var currentPath = '';
    var index = 0;

    // Remove the filename from parts (only create parent directories)
    parts.pop();

    function createNext() {
        if (index >= parts.length) {
            callback(null);
            return;
        }

        currentPath += '/' + parts[index];
        index++;

        self.createDirectory(currentPath, function(err) {
            // Ignore errors (directory might already exist)
            createNext();
        });
    }

    createNext();
};

WebDAVClient.prototype.exists = function(remotePath, callback) {
    this.request('PROPFIND', remotePath, {
        headers: {
            'Depth': '0'
        }
    }, function(err, statusCode, body) {
        if (err) {
            callback(err, false);
            return;
        }

        callback(null, statusCode >= 200 && statusCode < 300);
    });
};

module.exports = WebDAVClient;
