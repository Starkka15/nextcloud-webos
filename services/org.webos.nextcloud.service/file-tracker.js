// File state tracker for sync service
var fs = require('fs');
var path = require('path');
var config = require('./config');

var STATE_FILE = path.join(config.CONFIG_DIR, 'sync-state.json');

// Compatibility: check if file exists (old Node.js doesn't have fs.existsSync)
function fileExists(filepath) {
    try {
        fs.statSync(filepath);
        return true;
    } catch (e) {
        return false;
    }
}

var FileStatus = {
    PENDING: 'pending',
    UPLOADING: 'uploading',
    SYNCED: 'synced',
    ERROR: 'error'
};

function FileTracker() {
    this.state = {
        version: 1,
        files: {}
    };
    this.dirty = false;
}

FileTracker.prototype.load = function() {
    try {
        if (fileExists(STATE_FILE)) {
            var data = fs.readFileSync(STATE_FILE, 'utf8');
            this.state = JSON.parse(data);
            if (!this.state.files) {
                this.state.files = {};
            }
        }
    } catch (e) {
        console.error('Failed to load state:', e.message);
        this.state = { version: 1, files: {} };
    }
};

FileTracker.prototype.save = function() {
    if (!this.dirty) return;

    try {
        var data = JSON.stringify(this.state, null, 2);
        fs.writeFileSync(STATE_FILE, data, 'utf8');
        this.dirty = false;
    } catch (e) {
        console.error('Failed to save state:', e.message);
    }
};

FileTracker.prototype.getFile = function(relativePath) {
    return this.state.files[relativePath] || null;
};

FileTracker.prototype.setFile = function(relativePath, fileInfo) {
    this.state.files[relativePath] = fileInfo;
    this.dirty = true;
};

FileTracker.prototype.updateStatus = function(relativePath, status, extra) {
    var file = this.state.files[relativePath];
    if (file) {
        file.status = status;
        if (extra) {
            for (var key in extra) {
                file[key] = extra[key];
            }
        }
        this.dirty = true;
    }
};

FileTracker.prototype.needsSync = function(relativePath, mtime, size) {
    var file = this.state.files[relativePath];

    if (!file) {
        // New file
        return true;
    }

    if (file.status === FileStatus.SYNCED) {
        // Check if modified
        if (file.mtime !== mtime || file.size !== size) {
            return true;
        }
        return false;
    }

    if (file.status === FileStatus.PENDING || file.status === FileStatus.ERROR) {
        return true;
    }

    return false;
};

FileTracker.prototype.trackFile = function(relativePath, mtime, size) {
    var existing = this.state.files[relativePath];

    if (!existing) {
        this.state.files[relativePath] = {
            mtime: mtime,
            size: size,
            status: FileStatus.PENDING,
            errorCount: 0
        };
        this.dirty = true;
        return true;
    }

    // Check if file changed
    if (existing.mtime !== mtime || existing.size !== size) {
        existing.mtime = mtime;
        existing.size = size;
        existing.status = FileStatus.PENDING;
        this.dirty = true;
        return true;
    }

    return false;
};

FileTracker.prototype.markUploading = function(relativePath) {
    this.updateStatus(relativePath, FileStatus.UPLOADING);
};

FileTracker.prototype.markSynced = function(relativePath) {
    this.updateStatus(relativePath, FileStatus.SYNCED, {
        uploadedAt: Date.now(),
        errorCount: 0
    });
};

FileTracker.prototype.markError = function(relativePath, errorMessage) {
    var file = this.state.files[relativePath];
    if (file) {
        file.status = FileStatus.ERROR;
        file.errorCount = (file.errorCount || 0) + 1;
        file.lastError = errorMessage;
        this.dirty = true;
    }
};

FileTracker.prototype.getPendingFiles = function(maxRetries) {
    var pending = [];
    maxRetries = maxRetries || 3;

    for (var relativePath in this.state.files) {
        var file = this.state.files[relativePath];
        if (file.status === FileStatus.PENDING ||
            (file.status === FileStatus.ERROR && file.errorCount < maxRetries)) {
            pending.push({
                relativePath: relativePath,
                mtime: file.mtime,
                size: file.size,
                errorCount: file.errorCount || 0
            });
        }
    }

    return pending;
};

FileTracker.prototype.getStats = function() {
    var stats = {
        total: 0,
        pending: 0,
        synced: 0,
        error: 0,
        uploading: 0
    };

    for (var relativePath in this.state.files) {
        var file = this.state.files[relativePath];
        stats.total++;

        switch (file.status) {
            case FileStatus.PENDING:
                stats.pending++;
                break;
            case FileStatus.SYNCED:
                stats.synced++;
                break;
            case FileStatus.ERROR:
                stats.error++;
                break;
            case FileStatus.UPLOADING:
                stats.uploading++;
                break;
        }
    }

    return stats;
};

FileTracker.prototype.removeFile = function(relativePath) {
    if (this.state.files[relativePath]) {
        delete this.state.files[relativePath];
        this.dirty = true;
    }
};

FileTracker.prototype.clear = function() {
    this.state.files = {};
    this.dirty = true;
};

module.exports = {
    FileTracker: FileTracker,
    FileStatus: FileStatus
};
