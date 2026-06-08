const { WebSocketServer } = require('ws');

const OPEN = 1;
const KNOWN_MESSAGE_TYPES = new Set([
    'ping',
    'cmd',
    'event',
    'set-setting',
    'get-settings',
    'status',
    'track',
    'volStatus',
    'state',
    'wave',
    'waveFallback'
]);
const KNOWN_COMMANDS = new Set([
    'playPause',
    'next',
    'prev',
    'seek',
    'setVolume',
    'showWindow',
    'hideWindow',
    'like',
    'dislike',
    'shuffle',
    'repeat'
]);
const KNOWN_SETTINGS = new Set(['startAtLogin', 'autoShowOnPlay']);

function clampString(value, fallback = '', max = 300) {
    if (typeof value !== 'string') return fallback;
    return value.replace(/\s+/g, ' ').trim().slice(0, max) || fallback;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeTrackMessage(message) {
    return {
        ...message,
        title: clampString(message.title, 'Unknown Title'),
        artist: clampString(message.artist, 'Unknown Artist')
    };
}

function validateMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.v !== 1 || !KNOWN_MESSAGE_TYPES.has(message.type)) return false;

    if (message.type === 'cmd') {
        if (!KNOWN_COMMANDS.has(message.cmd)) return false;
        if (message.cmd === 'seek') return isFiniteNumber(message.valueSec) && message.valueSec >= 0;
        if (message.cmd === 'setVolume') return isFiniteNumber(message.value) && message.value >= 0 && message.value <= 1;
    }

    if (message.type === 'set-setting') {
        return KNOWN_SETTINGS.has(message.key) && typeof message.value === 'boolean';
    }

    if (message.type === 'event') {
        return message.name === 'playingStarted';
    }

    if (message.type === 'status') {
        return typeof message.msg === 'string' && message.msg.length <= 80;
    }

    if (message.type === 'state') {
        return ['positionSec', 'durationSec'].every((key) => message[key] === undefined || isFiniteNumber(message[key])) &&
            typeof message.playing === 'boolean';
    }

    if (message.type === 'wave') {
        return Array.isArray(message.data) &&
            message.data.length <= 128 &&
            message.data.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
    }

    return true;
}

function parseMessage(data) {
    let message;
    try {
        message = JSON.parse(data);
    } catch (e) {
        return null;
    }
    return validateMessage(message) ? message : null;
}

function createBridgeServer(options) {
    const {
        WebSocketServerImpl = WebSocketServer,
        host = '127.0.0.1',
        port = 18765,
        maxBackoffMs = 30000,
        onConnection = () => { },
        onMessage = () => { },
        onStatus = () => { },
        onError = () => { }
    } = options || {};

    let server = null;
    let activeClient = null;
    let restartTimer = null;
    let restartDelayMs = 1000;
    const clients = new Set();

    function send(ws, message) {
        if (ws && ws.readyState === OPEN) {
            ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    function broadcast(message) {
        let sent = 0;
        clients.forEach((client) => {
            if (send(client, message)) sent++;
        });
        return sent;
    }

    function cleanupClient(ws) {
        clients.delete(ws);
        if (activeClient === ws) activeClient = null;
    }

    function scheduleRestart() {
        if (restartTimer) return;
        restartTimer = setTimeout(() => {
            restartTimer = null;
            start();
        }, restartDelayMs);
        restartDelayMs = Math.min(restartDelayMs * 2, maxBackoffMs);
    }

    function start() {
        if (server) return server;

        server = new WebSocketServerImpl({ port, host });

        server.on('listening', () => {
            restartDelayMs = 1000;
            onStatus('listening', server);
        });

        server.on('connection', (ws, req) => {
            clients.add(ws);
            activeClient = ws;
            onConnection(ws, req);

            ws.on('message', (data) => {
                const message = parseMessage(data);
                if (!message) return;
                onMessage(message, ws);
            });

            ws.on('close', () => cleanupClient(ws));
            ws.on('error', (error) => {
                cleanupClient(ws);
                onError(error);
            });
        });

        server.on('error', (error) => {
            const oldServer = server;
            server = null;
            try {
                oldServer.close();
            } catch (e) { }
            onError(error);
            scheduleRestart();
        });

        return server;
    }

    function stop() {
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
        clients.forEach((client) => {
            try { client.close(); } catch (e) { }
        });
        clients.clear();
        activeClient = null;
        if (server) {
            const oldServer = server;
            server = null;
            oldServer.close();
        }
    }

    function relayCommand(command) {
        if (!validateMessage(command)) return false;
        return send(activeClient, command);
    }

    return {
        start,
        stop,
        broadcast,
        cleanupClient,
        relayCommand,
        get server() { return server; },
        get activeClient() { return activeClient; },
        get clientCount() { return clients.size; }
    };
}

module.exports = {
    KNOWN_COMMANDS,
    createBridgeServer,
    sanitizeTrackMessage,
    validateMessage
};
