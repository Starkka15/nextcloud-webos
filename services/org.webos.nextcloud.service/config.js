// Configuration management for Nextcloud Sync Service
var fs = require('fs');
var path = require('path');

var CONFIG_DIR = '/media/internal/appdata/org.webos.nextcloud';
var CONFIG_FILE = path.join(CONFIG_DIR, 'sync-config.json');

var defaultConfig = {
    serverUrl: '',
    username: '',
    password: '',
    watchFolder: '/media/internal/sync',
    remoteDestination: '/TouchPad-Backup',
    pollIntervalSec: 300,
    enabled: false,
    includeExtensions: ['*'],
    excludePatterns: ['*.tmp', '*.swp', '.~*', 'Thumbs.db', '.DS_Store'],
    maxFileSizeMB: 100
};

// Compatibility: check if file/dir exists (old Node.js doesn't have fs.existsSync)
function fileExists(filepath) {
    try {
        fs.statSync(filepath);
        return true;
    } catch (e) {
        return false;
    }
}

function ensureConfigDir() {
    try {
        if (!fileExists(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR);
        }
    } catch (e) {
        // Directory might already exist or parent doesn't exist
    }
}

function load() {
    ensureConfigDir();

    try {
        if (fileExists(CONFIG_FILE)) {
            var data = fs.readFileSync(CONFIG_FILE, 'utf8');
            var loaded = JSON.parse(data);
            // Merge with defaults to ensure all fields exist
            var config = {};
            for (var key in defaultConfig) {
                config[key] = loaded.hasOwnProperty(key) ? loaded[key] : defaultConfig[key];
            }
            return config;
        }
    } catch (e) {
        console.error('Failed to load config:', e.message);
    }

    return JSON.parse(JSON.stringify(defaultConfig));
}

function save(config) {
    ensureConfigDir();

    try {
        var data = JSON.stringify(config, null, 2);
        fs.writeFileSync(CONFIG_FILE, data, 'utf8');
        return true;
    } catch (e) {
        console.error('Failed to save config:', e.message);
        return false;
    }
}

function update(updates) {
    var config = load();
    for (var key in updates) {
        if (config.hasOwnProperty(key)) {
            config[key] = updates[key];
        }
    }
    save(config);
    return config;
}

function isConfigured() {
    var config = load();
    return config.serverUrl && config.username && config.password;
}

module.exports = {
    load: load,
    save: save,
    update: update,
    isConfigured: isConfigured,
    CONFIG_DIR: CONFIG_DIR
};
