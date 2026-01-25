// Nextcloud Sync Service - Main entry point
// Provides HTTP API for PDK app communication

var http = require('http');
var url = require('url');
var SyncEngine = require('./sync-engine');
var config = require('./config');

var PORT = 8787;
var engine = new SyncEngine();

// Parse JSON body from request
function parseBody(req, callback) {
    var body = '';

    req.on('data', function(chunk) {
        body += chunk.toString();
    });

    req.on('end', function() {
        if (body) {
            try {
                callback(null, JSON.parse(body));
            } catch (e) {
                callback(e, null);
            }
        } else {
            callback(null, {});
        }
    });
}

// Send JSON response
function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

// Request handler
function handleRequest(req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = parsed.pathname;

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // Route requests
    if (pathname === '/status' && req.method === 'GET') {
        // Get sync status
        var status = engine.getStatus();
        sendJSON(res, 200, status);

    } else if (pathname === '/start' && req.method === 'POST') {
        // Start sync
        engine.start();
        sendJSON(res, 200, { success: true, message: 'Sync started' });

    } else if (pathname === '/stop' && req.method === 'POST') {
        // Stop sync
        engine.stop();
        sendJSON(res, 200, { success: true, message: 'Sync stopped' });

    } else if (pathname === '/sync-now' && req.method === 'POST') {
        // Trigger immediate sync
        engine.syncNow();
        sendJSON(res, 200, { success: true, message: 'Sync triggered' });

    } else if (pathname === '/config' && req.method === 'GET') {
        // Get configuration (mask password)
        var cfg = config.load();
        cfg.password = cfg.password ? '********' : '';
        sendJSON(res, 200, cfg);

    } else if (pathname === '/config' && req.method === 'POST') {
        // Update configuration
        parseBody(req, function(err, body) {
            if (err) {
                sendJSON(res, 400, { error: 'Invalid JSON' });
                return;
            }

            engine.updateConfig(body);
            sendJSON(res, 200, { success: true, message: 'Configuration updated' });
        });

    } else if (pathname === '/test-connection' && req.method === 'POST') {
        // Test Nextcloud connection
        engine.testConnection(function(err) {
            if (err) {
                sendJSON(res, 200, { success: false, error: err.message });
            } else {
                sendJSON(res, 200, { success: true, message: 'Connection successful' });
            }
        });

    } else if (pathname === '/logs' && req.method === 'GET') {
        // Get recent logs
        var count = parseInt(parsed.query.count) || 50;
        var logs = engine.getLogs(count);
        sendJSON(res, 200, { logs: logs });

    } else if (pathname === '/clear-state' && req.method === 'POST') {
        // Clear tracked file state
        engine.clearState();
        sendJSON(res, 200, { success: true, message: 'State cleared' });

    } else if (pathname === '/health' && req.method === 'GET') {
        // Health check
        sendJSON(res, 200, { status: 'ok', version: '1.0.0' });

    } else {
        // Not found
        sendJSON(res, 404, { error: 'Not found' });
    }
}

// Create and start server
var server = http.createServer(handleRequest);

server.listen(PORT, '127.0.0.1', function() {
    console.log('[' + new Date().toISOString() + '] Nextcloud Sync Service listening on port ' + PORT);

    // Initialize sync engine
    engine.init();
});

// Handle graceful shutdown
process.on('SIGTERM', function() {
    console.log('Received SIGTERM, shutting down...');
    engine.stop();
    server.close(function() {
        process.exit(0);
    });
});

process.on('SIGINT', function() {
    console.log('Received SIGINT, shutting down...');
    engine.stop();
    server.close(function() {
        process.exit(0);
    });
});

// Keep process running
process.on('uncaughtException', function(err) {
    console.error('Uncaught exception:', err);
});
