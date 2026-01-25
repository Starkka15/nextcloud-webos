// Sync engine - monitors folder and uploads files to Nextcloud
var fs = require('fs');
var path = require('path');
var configModule = require('./config');
var WebDAVClient = require('./webdav-client');
var trackerModule = require('./file-tracker');
var FileTracker = trackerModule.FileTracker;

// Compatibility: String.endsWith for old Node.js
function endsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

// Compatibility: String.startsWith for old Node.js
function startsWith(str, prefix) {
    return str.indexOf(prefix) === 0;
}

function SyncEngine() {
    this.config = null;
    this.client = null;
    this.tracker = new FileTracker();
    this.running = false;
    this.syncTimer = null;
    this.currentUpload = null;
    this.logs = [];
    this.maxLogs = 100;
}

SyncEngine.prototype.log = function(level, message) {
    var now = new Date();
    var timestamp = now.toISOString();

    var entry = {
        timestamp: timestamp,
        level: level,
        message: message
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
        this.logs.shift();
    }

    console.log('[' + timestamp + '] [' + level.toUpperCase() + '] ' + message);
};

SyncEngine.prototype.init = function() {
    this.config = configModule.load();
    this.tracker.load();

    if (this.config.serverUrl && this.config.username && this.config.password) {
        this.client = new WebDAVClient(this.config);
    }

    this.log('info', 'Sync engine initialized');

    // Auto-start if enabled
    if (this.config.enabled && this.client) {
        this.start();
    }
};

SyncEngine.prototype.updateConfig = function(newConfig) {
    this.config = configModule.update(newConfig);

    // Recreate client with new credentials
    if (this.config.serverUrl && this.config.username && this.config.password) {
        this.client = new WebDAVClient(this.config);
    }

    this.log('info', 'Configuration updated');
};

SyncEngine.prototype.start = function() {
    if (this.running) {
        this.log('info', 'Sync already running');
        return;
    }

    if (!this.client) {
        this.log('error', 'Cannot start sync: not configured');
        return;
    }

    this.running = true;
    this.config.enabled = true;
    configModule.save(this.config);

    this.log('info', 'Sync started, watching: ' + this.config.watchFolder);
    this.log('info', 'Server: ' + this.config.serverUrl);
    this.log('info', 'User: ' + this.config.username);
    this.log('info', 'Remote dest: ' + this.config.remoteDestination);

    // Run initial sync
    this.runSyncCycle();

    // Schedule periodic syncs
    var self = this;
    this.syncTimer = setInterval(function() {
        self.runSyncCycle();
    }, this.config.pollIntervalSec * 1000);
};

SyncEngine.prototype.stop = function() {
    if (!this.running) {
        return;
    }

    this.running = false;
    this.config.enabled = false;
    configModule.save(this.config);

    if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
    }

    this.log('info', 'Sync stopped');
};

SyncEngine.prototype.runSyncCycle = function() {
    if (!this.running) return;

    var self = this;
    this.log('info', 'Starting sync cycle');

    // Phase 1: Scan directory
    this.scanDirectory(this.config.watchFolder, '', function(err) {
        if (err) {
            self.log('error', 'Directory scan failed: ' + err.message);
            return;
        }

        // Phase 2: Process upload queue
        self.processUploadQueue(function() {
            // Phase 3: Save state
            self.tracker.save();
            self.log('info', 'Sync cycle complete');
        });
    });
};

SyncEngine.prototype.scanDirectory = function(basePath, relativePath, callback) {
    var self = this;
    var fullPath = relativePath ? path.join(basePath, relativePath) : basePath;

    fs.readdir(fullPath, function(err, files) {
        if (err) {
            callback(err);
            return;
        }

        var index = 0;

        function processNext() {
            if (index >= files.length) {
                callback(null);
                return;
            }

            var filename = files[index];
            index++;

            // Skip hidden files
            if (filename.charAt(0) === '.') {
                processNext();
                return;
            }

            var fileRelativePath = relativePath ? path.join(relativePath, filename) : filename;
            var fileFullPath = path.join(basePath, fileRelativePath);

            fs.stat(fileFullPath, function(err, stats) {
                if (err) {
                    processNext();
                    return;
                }

                if (stats.isDirectory()) {
                    // Recurse into subdirectory
                    self.scanDirectory(basePath, fileRelativePath, function() {
                        processNext();
                    });
                } else if (stats.isFile()) {
                    // Check if file should be synced
                    if (self.shouldSyncFile(filename, stats.size)) {
                        var mtime = Math.floor(stats.mtime.getTime() / 1000);
                        if (self.tracker.trackFile(fileRelativePath, mtime, stats.size)) {
                            self.log('info', 'Queued for upload: ' + fileRelativePath);
                        }
                    }
                    processNext();
                } else {
                    processNext();
                }
            });
        }

        processNext();
    });
};

SyncEngine.prototype.shouldSyncFile = function(filename, size) {
    // Check size limit
    var maxSize = this.config.maxFileSizeMB * 1024 * 1024;
    if (maxSize > 0 && size > maxSize) {
        return false;
    }

    // Check exclude patterns
    var excludePatterns = this.config.excludePatterns || [];
    for (var i = 0; i < excludePatterns.length; i++) {
        if (this.matchPattern(filename, excludePatterns[i])) {
            return false;
        }
    }

    // Check include extensions
    var includeExtensions = this.config.includeExtensions || ['*'];
    if (includeExtensions.indexOf('*') >= 0) {
        return true;
    }

    var ext = path.extname(filename).toLowerCase();
    for (var i = 0; i < includeExtensions.length; i++) {
        var pattern = includeExtensions[i].toLowerCase();
        if (pattern === ext || pattern === '*' + ext) {
            return true;
        }
    }

    return false;
};

SyncEngine.prototype.matchPattern = function(filename, pattern) {
    // Simple glob matching for *.ext and prefix*
    var filenameLower = filename.toLowerCase();
    var patternLower = pattern.toLowerCase();

    if (pattern.charAt(0) === '*') {
        // *.ext pattern
        var suffix = patternLower.substring(1);
        return endsWith(filenameLower, suffix);
    } else if (pattern.charAt(pattern.length - 1) === '*') {
        // prefix* pattern
        var prefix = patternLower.substring(0, patternLower.length - 1);
        return startsWith(filenameLower, prefix);
    } else {
        // Exact match
        return filenameLower === patternLower;
    }
};

SyncEngine.prototype.processUploadQueue = function(callback) {
    var self = this;
    var pending = this.tracker.getPendingFiles(this.config.maxRetries || 3);

    if (pending.length === 0) {
        callback();
        return;
    }

    this.log('info', 'Processing ' + pending.length + ' files');

    var index = 0;

    function uploadNext() {
        if (index >= pending.length || !self.running) {
            callback();
            return;
        }

        var file = pending[index];
        index++;

        self.uploadFile(file.relativePath, function(err) {
            if (err) {
                self.log('error', 'Upload failed: ' + file.relativePath + ' - ' + err.message);
            } else {
                self.log('info', 'Uploaded: ' + file.relativePath);
            }

            // Small delay between uploads to avoid overwhelming server
            setTimeout(uploadNext, 500);
        });
    }

    uploadNext();
};

SyncEngine.prototype.uploadFile = function(relativePath, callback) {
    var self = this;
    var localPath = path.join(this.config.watchFolder, relativePath);
    var remotePath = path.join(this.config.remoteDestination, relativePath);

    // Normalize path separators for WebDAV
    remotePath = remotePath.split(path.sep).join('/');
    if (remotePath.charAt(0) !== '/') {
        remotePath = '/' + remotePath;
    }

    this.currentUpload = relativePath;
    this.tracker.markUploading(relativePath);

    // Ensure remote directory exists
    this.client.ensureDirectoryExists(remotePath, function(err) {
        if (err) {
            self.tracker.markError(relativePath, err.message);
            self.currentUpload = null;
            callback(err);
            return;
        }

        // Upload file
        self.client.uploadFile(localPath, remotePath, null, function(err) {
            self.currentUpload = null;

            if (err) {
                self.tracker.markError(relativePath, err.message);
                callback(err);
            } else {
                self.tracker.markSynced(relativePath);
                callback(null);
            }
        });
    });
};

SyncEngine.prototype.syncNow = function() {
    if (!this.client) {
        this.log('error', 'Cannot sync: not configured');
        return;
    }

    this.log('info', 'Manual sync triggered');
    this.runSyncCycle();
};

SyncEngine.prototype.testConnection = function(callback) {
    if (!this.client) {
        callback(new Error('Not configured'));
        return;
    }

    this.client.testConnection(callback);
};

SyncEngine.prototype.getStatus = function() {
    var stats = this.tracker.getStats();

    return {
        running: this.running,
        configured: !!this.client,
        watchFolder: this.config.watchFolder,
        remoteDestination: this.config.remoteDestination,
        pollIntervalSec: this.config.pollIntervalSec,
        currentUpload: this.currentUpload,
        files: stats
    };
};

SyncEngine.prototype.getLogs = function(count) {
    count = count || 50;
    return this.logs.slice(-count);
};

SyncEngine.prototype.clearState = function() {
    this.tracker.clear();
    this.tracker.save();
    this.log('info', 'State cleared');
};

module.exports = SyncEngine;
