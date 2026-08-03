const { WebSocketServer } = require('ws');

const OPEN = 1;
const KNOWN_MESSAGE_TYPES = new Set([
    'auth',
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

function isString(value, maxLength = 1024) {
    return typeof value === 'string' && value.length <= maxLength;
}

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

    if (message.type === 'auth') {
        return isString(message.token, 512);
    }

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

function parseClientToken(req) {
    if (!req || !req.url) return '';
    try {
        const url = new URL(req.url, `ws://${req.headers.host || '127.0.0.1'}`);
        return url.searchParams.get('token') || '';
    } catch (error) {
        return '';
    }
}

function sanitizeToken(value) {
    return isString(value, 512) ? value.trim() : '';
}

function createBridgeServer(options) {
    const {
        WebSocketServerImpl = WebSocketServer,
        host = '127.0.0.1',
        port = 18765,
        maxBackoffMs = 30000,
        allowUnauthenticated = true,
        expectedAuthToken = '',
        authTimeoutMs = 5000,
        onConnection = () => { },
        onAuth = () => { },
        onMessage = () => { },
        onStatus = () => { },
        onError = () => { }
    } = options || {};

    const trimmedExpectedToken = sanitizeToken(expectedAuthToken);
    const hasExpectedToken = Boolean(trimmedExpectedToken);
    const authEnabled = hasExpectedToken && !allowUnauthenticated;

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
        if (ws && ws.__ytmampAuthTimer) {
            clearTimeout(ws.__ytmampAuthTimer);
            ws.__ytmampAuthTimer = null;
        }
        clients.delete(ws);
        if (activeClient === ws) activeClient = null;
    }

    function activateClient(ws, req) {
        if (ws.__ytmampAuthTimer) {
            clearTimeout(ws.__ytmampAuthTimer);
            ws.__ytmampAuthTimer = null;
        }

        if (ws.__ytmampAuthed) return;
        ws.__ytmampAuthed = true;
        activeClient = ws;
        onAuth('ok', ws);
        onConnection(ws, req);
    }

    function requireAuth(ws, req, reason) {
        const message = { type: 'auth-error', v: 1, reason };
        send(ws, message);
        onAuth('invalid', ws, reason);
        ws.close(4003, 'unauthorized');
    }

    function scheduleRestart() {
        if (restartTimer) return;
        restartTimer = setTimeout(() => {
            restartTimer = null;
            start();
        }, restartDelayMs);
        restartDelayMs = Math.min(restartDelayMs * 2, maxBackoffMs);
    }

    function finalizeHandshake(ws, req) {
        if (!authEnabled) {
            activeClient = ws;
            onConnection(ws, req);
            return;
        }

        const token = parseClientToken(req);
        if (token && token === trimmedExpectedToken) {
            send(ws, { type: 'auth-ok', v: 1 });
            activateClient(ws, req);
            return;
        }

        send(ws, { type: 'auth-request', v: 1 });
        ws.__ytmampAuthTimer = setTimeout(() => {
            if (!ws.__ytmampAuthed) {
                requireAuth(ws, req, 'auth timeout');
            }
        }, authTimeoutMs);
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
            ws.__ytmampAuthed = false;
            ws.__ytmampAuthTimer = null;
            finalizeHandshake(ws, req);

            ws.on('message', (data) => {
                const message = parseMessage(data);
                if (!message) return;
                if (!ws.__ytmampAuthed && authEnabled) {
                    if (message.type === 'auth') {
                        if (isString(message.token, 512) && message.token === trimmedExpectedToken) {
                            send(ws, { type: 'auth-ok', v: 1 });
                            activateClient(ws, req);
                            return;
                        }
                        onAuth('invalid', ws);
                        requireAuth(ws, req, 'invalid token');
                        return;
                    }

                    requireAuth(ws, req, 'auth required');
                    return;
                }
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
