const { app, BrowserWindow, clipboard, ipcMain, Tray, Menu, nativeImage, screen, dialog, protocol, shell } = require('electron');
const { createYtmLauncher } = require('./ytm_launcher');
const { locateMac } = require('./device_location');
const { pathToFileURL } = require('node:url');
const { LocalCollection } = require('./local_collection');
const { createLocalMediaHandler } = require('./local_media');
const { LocalPlayer } = require('./local_player');
const { RadioLibrary } = require('./radio_library');
const { RadioPlayer } = require('./radio_player');
const { RadioRecorder } = require('./radio_recorder');
const { createRadioMediaHandler } = require('./radio_network');

protocol.registerSchemesAsPrivileged([{ scheme: 'ytmamp-media', privileges: {
    standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true
} }]);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { createBridgeServer, sanitizeTrackMessage, validateMessage } = require('./ws_bridge');
const { createEventBus } = require('./event_bus');
const { createPluginRuntime } = require('./plugin_runtime');
const { configurePlayerCastBridge, playerGetState, playerAction } = require('./playerCastBridge');
const {
    assertSafeIntegrationConfig,
    getCastCorsHeaders,
    isAuthorizedRequest,
    parseOriginAllowlist
} = require('./integration_security');
const { createObsOverlayService } = require('../integrations/obs');
const { createLastFmScrobbler, DEFAULT_TRACK_THRESHOLD_SEC, DEFAULT_MIN_TRACK_DURATION_SEC } = require('../integrations/lastfm');
const {
    INTEGRATION_API_VERSION,
    getRequestedIntegrationApiVersion,
    isSupportedIntegrationApiVersion,
    validateCanonicalPayload,
    validateIntegrationEventEnvelope
} = require('./integration_api_contract');

let mainWindow;
let tray;
let bridge;
let isQuitting = false;
let pluginRuntime;
let lastfmScrobbler;
let activeSource = 'local';
let ytmStatus = 'Need YTM Tab';
const ytmSnapshot = { track: null, state: null };
let folderScan;
let libraryVisible = false;
let hiddenByUser = false;
let collection;
let collectionReady;
let choosingFolder = false;
let radioLibrary;
let radioPlayer;
let radioRecorder;
let radioSaving = false;
let radioQuitAccepted = false;
let radioQuitPrompt = false;
let radioActionBusy = false;
let radioLocationPermissionUntil = 0;
const launchYtm = createYtmLauncher({ openExternal: (url) => shell.openExternal(url) });
const localPlayer = new LocalPlayer();
const pluginRuntimeStatusQueue = [];
const pluginRuntimeUiQueue = [];
const playerStateBus = createEventBus({ dedupeWindowMs: 350 });
const playerState = {
    track: null,
    state: null,
    lastTs: 0
};
const stateEventDedupWindowMs = 350;
const localTrustEnabled = ['1', 'true', 'yes', 'on'].includes((process.env.LOCAL_TRUST || '').toLowerCase());
const envBridgeToken = (process.env.BRIDGE_TOKEN || '').trim();
const integrationEnvToken = (process.env.INTEGRATION_TOKEN || '').trim();
const INTEGRATION_HOST = process.env.INTEGRATION_HOST || '127.0.0.1';
const INTEGRATION_PORT = Number(process.env.INTEGRATION_PORT) || 18880;
const CAST_ORIGIN_ALLOWLIST = parseOriginAllowlist(process.env.CAST_ORIGIN_ALLOWLIST || '');
const integrationNetworkPolicy = assertSafeIntegrationConfig({
    host: INTEGRATION_HOST,
    token: integrationEnvToken
});
const OBS_ORIGIN_ALLOWLIST = parseEnvOriginList(process.env.OBS_ORIGIN_ALLOWLIST || '');
const LASTFM_ENABLED = ['1', 'true', 'yes', 'on'].includes((process.env.LASTFM_ENABLED || '').toLowerCase());
const LASTFM_TRACK_THRESHOLD_SEC = Number.parseInt(process.env.LASTFM_TRACK_THRESHOLD_SEC || '', 10) || DEFAULT_TRACK_THRESHOLD_SEC;
const LASTFM_MIN_TRACK_DURATION_SEC = Number.parseInt(process.env.LASTFM_MIN_TRACK_DURATION_SEC || '', 10) || DEFAULT_MIN_TRACK_DURATION_SEC;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const MAX_SSE_CLIENTS = 25;
let integrationServer;
const integrationSseClients = new Set();
const integrationRateBuckets = new Map();
let appStatus = 'LOCAL';
const obsOverlay = createObsOverlayService({
    allowlist: OBS_ORIGIN_ALLOWLIST,
    logger: {
        debug: (...args) => console.debug('[OBS]', ...args),
        warn: (...args) => console.warn('[OBS]', ...args),
        error: (...args) => console.error('[OBS]', ...args),
        info: (...args) => console.info('[OBS]', ...args)
    }
});

function parseEnvOriginList(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function notifyPlayerEvent(eventType, payload) {
    if (eventType === 'track') {
        playerState.track = payload;
        playerState.lastTs = Date.now();
    }
    if (eventType === 'state') {
        playerState.state = payload;
        playerState.lastTs = Date.now();
    }
}

function publishPlayerEvent(eventType, payload, options = {}) {
    const published = playerStateBus.emit(eventType, payload, options);
    if (!published) return;
    notifyPlayerEvent(eventType, payload);
}

function publishTrack(message) {
    publishPlayerEvent('track', sanitizeTrackMessage(message), {
        dedupeMs: stateEventDedupWindowMs
    });
}

function publishState(state) {
    const payload = {
        ...state,
        positionSec: Number.isFinite(state.positionSec) ? state.positionSec : 0,
        durationSec: Number.isFinite(state.durationSec) ? state.durationSec : 0,
        playing: typeof state.playing === 'boolean' ? state.playing : false
    };

    publishPlayerEvent('state', payload, {
        dedupeMs: stateEventDedupWindowMs
    });
}

playerStateBus.on('track', (payload) => {
    if (mainWindow) {
        mainWindow.webContents.send('track-update', payload);
    }
    broadcastIntegrationEvent('track', payload);
    if (lastfmScrobbler) {
        lastfmScrobbler.handleTrack(payload);
    }
});

playerStateBus.on('state', (payload) => {
    if (mainWindow) {
        mainWindow.webContents.send('state-update', payload);
    }
    broadcastIntegrationEvent('state', payload);
    if (lastfmScrobbler) {
        lastfmScrobbler.handleState(payload);
    }
});

function parseEnvInt(value, fallback) {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function setupLastFmScrobbling() {
    const apiKey = (process.env.LASTFM_API_KEY || '').trim();
    const apiSecret = (process.env.LASTFM_API_SECRET || '').trim();
    const sessionKey = (process.env.LASTFM_SESSION_KEY || '').trim();

    if (!LASTFM_ENABLED && !(apiKey && apiSecret && sessionKey)) {
        console.log('[LastFM] Disabled (missing env config)');
        return;
    }

    const queueStoragePath = path.join(app.getPath('userData'), 'lastfm-scrobble-queue.json');
    lastfmScrobbler = createLastFmScrobbler({
        enabled: true,
        apiKey,
        apiSecret,
        sessionKey,
        thresholdSec: parseEnvInt(process.env.LASTFM_TRACK_THRESHOLD_SEC, LASTFM_TRACK_THRESHOLD_SEC),
        minDurationSec: parseEnvInt(process.env.LASTFM_MIN_TRACK_DURATION_SEC, LASTFM_MIN_TRACK_DURATION_SEC),
        processIntervalMs: parseEnvInt(process.env.LASTFM_PROCESS_INTERVAL_MS, 1500),
        baseRetryMs: parseEnvInt(process.env.LASTFM_RETRY_BASE_MS, 5000),
        maxRetryMs: parseEnvInt(process.env.LASTFM_RETRY_MAX_MS, 120000),
        queueStoragePath,
        logger: {
            debug: (...args) => console.debug('[LastFM]', ...args),
            info: (...args) => console.info('[LastFM]', ...args),
            warn: (...args) => console.warn('[LastFM]', ...args),
            error: (...args) => console.error('[LastFM]', ...args)
        }
    });

    if (lastfmScrobbler) {
        lastfmScrobbler.start();
        console.log('[LastFM] Scrobbling enabled');
    }
}

function parseRemoteIp(req) {
    const raw = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
    if (raw === '::1') return '127.0.0.1';
    return raw.startsWith('::ffff:') ? raw.replace('::ffff:', '') : raw;
}

function normalizeIp(ip) {
    if (!ip) return '';
    const trimmed = String(ip).trim();
    if (trimmed === '::1') return '127.0.0.1';
    return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

function isLocalRequest(req) {
    const ip = parseRemoteIp(req);
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function isPrivateIpv4(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    const octets = parts.map((part) => Number.parseInt(part, 10));
    if (octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) return false;

    const [first, second] = octets;
    return first === 10
        || first === 127
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 169 && second === 254);
}

function isPrivateIpv6(ip) {
    return /^::1$/.test(ip) ||
        /^fd[0-9a-f]{2}:/i.test(ip) ||
        /^fe80:/i.test(ip);
}

function isLanRequest(req) {
    const ip = normalizeIp(parseRemoteIp(req));
    return ip === '127.0.0.1' || isPrivateIpv4(ip) || isPrivateIpv6(ip);
}

function isCastApiPath(pathname = '') {
    return pathname === '/api/cast/status' || pathname === '/api/cast/cmd';
}

function formatCastResponse(res, statusCode, payload, req, extraHeaders = {}) {
    const origin = req && req.headers && req.headers.origin;
    const corsHeaders = getCastCorsHeaders(origin, CAST_ORIGIN_ALLOWLIST) || {};
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-ytmamp-api-version': String(INTEGRATION_API_VERSION),
        ...corsHeaders,
        ...extraHeaders,
        'content-length': Buffer.byteLength(body)
    });
    res.end(body);
}

function sendCastNoTrack(res, req) {
    return formatCastResponse(res, 200, {
        ok: false,
        state: 'stopped',
        source: 'ytmamp',
        error: 'no_active_track'
    }, req);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString('utf8');
            if (body.length > 4096) {
                req.removeAllListeners('data');
                req.removeAllListeners('end');
                reject(new Error('payload_too_large'));
            }
        });

        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(error);
            }
        });

        req.on('error', reject);
    });
}

function getRateBucket(ip) {
    const now = Date.now();
    const bucket = integrationRateBuckets.get(ip) || { count: 0, start: now };
    if (now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
        bucket.count = 0;
        bucket.start = now;
    }
    bucket.count++;
    integrationRateBuckets.set(ip, bucket);
    return bucket;
}

function getRetryAfterMs(bucket) {
    const elapsed = Date.now() - bucket.start;
    return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000));
}

function createCanonicalPayload() {
    return {
        v: INTEGRATION_API_VERSION,
        status: appStatus,
        track: playerState.track,
        state: playerState.state,
        updatedAt: playerState.lastTs || 0,
        windowVisible: !!(mainWindow && mainWindow.isVisible())
    };
}

function formatJsonResponse(res, statusCode, payload) {
    if (!validateCanonicalPayload(payload)) {
        res.writeHead(500, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        });
        res.end(JSON.stringify({
            v: INTEGRATION_API_VERSION,
            error: 'INVALID_CANONICAL_PAYLOAD'
        }));
        return false;
    }

    const json = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-ytmamp-api-version': String(INTEGRATION_API_VERSION),
        'content-length': Buffer.byteLength(json)
    });
    res.end(json);
    return true;
}

function broadcastIntegrationEvent(name, payload) {
    if (!integrationSseClients.size) return;
    const bodyPayload = {
        type: name,
        v: INTEGRATION_API_VERSION,
        payload
    };
    if (!validateIntegrationEventEnvelope(bodyPayload)) {
        return;
    }
    const body = JSON.stringify(bodyPayload);
    const chunk = `event: ${name}\ndata: ${body}\n\n`;
    integrationSseClients.forEach((client) => {
        try {
            client.write(chunk);
        } catch (error) {
            integrationSseClients.delete(client);
        }
    });
}

function setupIntegrationServer() {
    integrationServer = http.createServer((req, res) => {
        const integrationBaseHeaders = {
            'x-ytmamp-api-version': String(INTEGRATION_API_VERSION)
        };
        const obsPayloadHeaders = {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            ...integrationBaseHeaders
        };
        (async () => {
            if (!req.url) {
                res.writeHead(400, integrationBaseHeaders);
                res.end('bad request');
                return;
            }

            const parsedUrl = new URL(req.url, `http://${INTEGRATION_HOST}:${INTEGRATION_PORT}`);
            const query = parsedUrl.searchParams;
            const isCastApi = isCastApiPath(parsedUrl.pathname);

            if (isCastApi) {
                if (!isLanRequest(req)) {
                    res.writeHead(403, {
                        ...integrationBaseHeaders,
                        'content-type': 'text/plain; charset=utf-8'
                    });
                    res.end('forbidden');
                    return;
                }

                const castCorsHeaders = getCastCorsHeaders(req.headers.origin, CAST_ORIGIN_ALLOWLIST);
                if (castCorsHeaders === null) {
                    res.writeHead(403, {
                        ...integrationBaseHeaders,
                        'content-type': 'text/plain; charset=utf-8'
                    });
                    res.end('forbidden origin');
                    return;
                }

                if (req.method === 'OPTIONS') {
                    res.writeHead(204, {
                        ...integrationBaseHeaders,
                        ...castCorsHeaders,
                        'access-control-max-age': '300'
                    });
                    res.end();
                    return;
                }
            } else {
                if (!isLocalRequest(req)) {
                    res.writeHead(403, {
                        ...integrationBaseHeaders,
                        'content-type': 'text/plain; charset=utf-8'
                    });
                    res.end('forbidden');
                    return;
                }
            }

            const token = query.get('token');
            const apiVersion = getRequestedIntegrationApiVersion(query, req.headers);

            if (!isSupportedIntegrationApiVersion(apiVersion)) {
                res.writeHead(400, {
                    ...integrationBaseHeaders,
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': 'no-store'
                });
                res.end(JSON.stringify({
                    v: INTEGRATION_API_VERSION,
                    error: 'UNSUPPORTED_API_VERSION',
                    requested: apiVersion,
                    supported: [INTEGRATION_API_VERSION]
                }));
                return;
            }

            if (!isAuthorizedRequest(req, token, integrationEnvToken)) {
                res.writeHead(401, {
                    ...integrationBaseHeaders,
                    'www-authenticate': 'Bearer realm="ytmamp-local"',
                    'content-type': 'text/plain; charset=utf-8'
                });
                res.end('unauthorized');
                return;
            }

            const bucket = getRateBucket(parseRemoteIp(req));
            if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
                res.writeHead(429, {
                    ...integrationBaseHeaders,
                    'retry-after': String(getRetryAfterMs(bucket)),
                    'content-type': 'text/plain; charset=utf-8'
                });
                res.end('rate limit exceeded');
                return;
            }

            if (req.method === 'GET' && parsedUrl.pathname === '/status') {
                const payload = {
                    ...createCanonicalPayload()
                };
                if (formatJsonResponse(res, 200, payload) === false) return;
                return;
            }

            if (req.method === 'GET' && parsedUrl.pathname === '/current-track') {
                if (!playerState.track) {
                    res.writeHead(204, {
                        ...integrationBaseHeaders,
                        'cache-control': 'no-store'
                    });
                    res.end();
                    return;
                }

                const payload = {
                    ...createCanonicalPayload(),
                    track: playerState.track
                };
                if (formatJsonResponse(res, 200, payload) === false) return;
                return;
            }

            if (req.method === 'GET' && parsedUrl.pathname === '/api/cast/status') {
                const state = await playerGetState();
                if (!state) {
                    sendCastNoTrack(res, req);
                    return;
                }

                formatCastResponse(res, 200, {
                    ok: true,
                    state: state.state || 'stopped',
                    source: 'ytmamp',
                    track: state.track || {
                        title: '',
                        artist: '',
                        album: '',
                        track_id: '',
                        duration_ms: 0,
                        position_ms: 0
                    },
                    time: state.time || Date.now()
                }, req);
                return;
            }

            if (req.method === 'POST' && parsedUrl.pathname === '/api/cast/cmd') {
                let payload;
                try {
                    payload = await readJsonBody(req);
                } catch (error) {
                    formatCastResponse(res, 400, {
                        ok: false,
                        state: 'error',
                        source: 'ytmamp',
                        error: error.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_json'
                    }, req);
                    return;
                }
                const action = String(payload && payload.action ? payload.action : '').trim().toLowerCase();
                const allowed = new Set(['play', 'pause', 'toggle', 'stop', 'next', 'prev']);
                if (!allowed.has(action)) {
                    formatCastResponse(res, 400, {
                        ok: false,
                        state: 'error',
                        source: 'ytmamp',
                        error: 'invalid_action'
                    }, req);
                    return;
                }

                const actionResult = await playerAction(action);
                if (!actionResult?.ok) {
                    if (actionResult?.error === 'no_active_track') {
                        sendCastNoTrack(res, req);
                    } else {
                        formatCastResponse(res, 200, {
                            ok: false,
                            state: 'error',
                            source: 'ytmamp',
                            error: actionResult?.error || 'action_failed'
                        }, req);
                    }
                    return;
                }

                const state = await playerGetState();
                if (!state) {
                    sendCastNoTrack(res, req);
                    return;
                }

                formatCastResponse(res, 200, {
                    ok: true,
                    state: state.state || 'stopped',
                    source: 'ytmamp',
                    track: state.track || {
                        title: '',
                        artist: '',
                        album: '',
                        track_id: '',
                        duration_ms: 0,
                        position_ms: 0
                    },
                    time: state.time || Date.now()
                }, req);
                return;
            }

            const obsOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
            const isObsRequest = parsedUrl.pathname === '/obs';

            if (isObsRequest && req.method === 'OPTIONS') {
                if (!obsOverlay.isOriginAllowed(obsOrigin)) {
                    res.writeHead(403, {
                        ...integrationBaseHeaders,
                        'content-type': 'text/plain; charset=utf-8'
                    });
                    res.end('forbidden');
                    return;
                }

                const preflightHeaders = obsOverlay.getCorsHeaders(obsOrigin);
                res.writeHead(204, {
                    ...integrationBaseHeaders,
                    'access-control-allow-methods': 'GET, OPTIONS',
                    'access-control-allow-headers': 'Authorization, X-YTMAMP-Token, Content-Type',
                    'access-control-max-age': '300',
                    ...preflightHeaders
                });
                res.end();
                return;
            }

            if (isObsRequest && req.method === 'GET') {
                if (!obsOverlay.isOriginAllowed(obsOrigin)) {
                    res.writeHead(403, {
                        ...integrationBaseHeaders,
                        'content-type': 'text/plain; charset=utf-8'
                    });
                    res.end('forbidden');
                    return;
                }

                const payload = obsOverlay.buildPayload({
                    track: playerState.track,
                    state: playerState.state
                });
                if (!payload || !obsOverlay.isValidPayload(payload)) {
                    res.writeHead(204, {
                        ...integrationBaseHeaders,
                        'cache-control': 'no-store'
                    });
                    res.end();
                    return;
                }

                const headers = {
                    ...obsPayloadHeaders,
                    ...obsOverlay.getCorsHeaders(obsOrigin)
                };
                const responseBody = JSON.stringify(payload);
                res.writeHead(200, {
                    ...headers,
                    'content-length': Buffer.byteLength(responseBody)
                });
                res.end(responseBody);
                return;
            }

            if (parsedUrl.pathname === '/events' && req.method === 'GET') {
                if (integrationSseClients.size >= MAX_SSE_CLIENTS) {
                    res.writeHead(429, {
                        ...integrationBaseHeaders,
                        'content-type': 'text/plain; charset=utf-8',
                        'retry-after': '1'
                    });
                    res.end('too many SSE clients');
                    return;
                }

                res.writeHead(200, {
                    ...integrationBaseHeaders,
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-store',
                    connection: 'keep-alive',
                    'x-accel-buffering': 'no'
                });
                res.write(': connected\n\n');
                const snapshotPayload = {
                    type: 'snapshot',
                    v: INTEGRATION_API_VERSION,
                    payload: createCanonicalPayload()
                };
                if (!validateIntegrationEventEnvelope(snapshotPayload)) {
                    res.writeHead(500, {
                        ...integrationBaseHeaders,
                        'content-type': 'application/json; charset=utf-8',
                        'cache-control': 'no-store'
                    });
                    res.end(JSON.stringify({
                        v: INTEGRATION_API_VERSION,
                        error: 'INVALID_CANONICAL_PAYLOAD'
                    }));
                    return;
                }
                const payload = JSON.stringify(snapshotPayload);
                res.write(`event: snapshot\ndata: ${payload}\n\n`);
                const heartbeat = setInterval(() => {
                    try {
                        res.write(': heartbeat\n\n');
                    } catch (error) {
                        clearInterval(heartbeat);
                    }
                }, 10000);
                const cleanup = () => {
                    clearInterval(heartbeat);
                    integrationSseClients.delete(res);
                };
                req.on('close', cleanup);
                req.on('aborted', cleanup);
                integrationSseClients.add(res);
                return;
            }

            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('not found');
        })().catch((error) => {
            console.error('[LocalAPI] request error:', error.message);
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('internal error');
        });
    });

    integrationServer.on('error', (error) => {
        console.error('[LocalAPI] server error:', error.message);
    });

    integrationServer.listen(INTEGRATION_PORT, INTEGRATION_HOST, () => {
        console.log(`[LocalAPI] listening on http://${INTEGRATION_HOST}:${INTEGRATION_PORT}`);
        console.log(`[LocalAPI] LAN access: ${integrationNetworkPolicy.lanEnabled ? 'enabled with token auth' : 'disabled'}`);
        console.log('[LocalAPI] endpoints: /status, /current-track, /events, /obs, /api/cast/status, /api/cast/cmd');
    });
}

// --- Settings Persistence ---
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = {
    startAtLogin: false,
    autoShowOnPlay: true,
    windowBounds: null,
    bridgeAuthToken: '',
    localFolder: '',
    localTrackId: '',
    localVolume: 0.5,
    playerScale: 100,
    radioVolume: 0.5
};

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
            settings.startAtLogin = typeof settings.startAtLogin === 'boolean' ? settings.startAtLogin : !!settings.startAtLogin;
            settings.autoShowOnPlay = typeof settings.autoShowOnPlay === 'boolean' ? settings.autoShowOnPlay : true;
            settings.bridgeAuthToken = (typeof settings.bridgeAuthToken === 'string' && settings.bridgeAuthToken.length <= 512) ? settings.bridgeAuthToken : '';
            settings.playerScale = [75, 100, 125, 150].includes(settings.playerScale) ? settings.playerScale : 100;
            if (settings.windowBounds && (typeof settings.windowBounds.x !== 'number' || typeof settings.windowBounds.y !== 'number')) {
                settings.windowBounds = null;
            }
        }
    } catch (e) {
        console.error('[Main] Failed to load settings:', e);
        settings = { ...settings };
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('[Main] Failed to save settings:', e);
    }
}

function quoteDesktopExec(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function applyLinuxAutostart() {
    const autostartDir = path.join(app.getPath('home'), '.config', 'autostart');
    const desktopFile = path.join(autostartDir, 'ytmamp.desktop');

    try {
        if (!settings.startAtLogin) {
            if (fs.existsSync(desktopFile)) fs.unlinkSync(desktopFile);
            console.log('[Main] Linux autostart disabled');
            return;
        }

        fs.mkdirSync(autostartDir, { recursive: true });
        fs.writeFileSync(desktopFile, [
            '[Desktop Entry]',
            'Type=Application',
            'Version=1.0',
            'Name=YTMamp',
            'Comment=Start YTMamp at login',
            `Exec=${quoteDesktopExec(app.getPath('exe'))}`,
            'Terminal=false',
            'X-GNOME-Autostart-enabled=true',
            ''
        ].join('\n'));
        console.log('[Main] Linux autostart enabled');
    } catch (e) {
        console.error('[Main] Failed to apply Linux autostart:', e);
    }
}

function applyAutostart() {
    try {
        if (process.platform === 'darwin' || process.platform === 'win32') {
            app.setLoginItemSettings({
                openAtLogin: settings.startAtLogin,
                openAsHidden: false,
                path: app.getPath('exe')
            });
            console.log(`[Main] Autostart set to: ${settings.startAtLogin}`);
            return true;
        }
        if (process.platform === 'linux') {
            applyLinuxAutostart();
            return true;
        }
    } catch (e) {
        console.error('[Main] Failed to apply autostart:', e);
    }

    return false;
}

function broadcastSettings() {
    if (!bridge) return;
    bridge.broadcast({ type: 'settings', v: 1, settings });
}

function broadcastVisibility() {
    if (!bridge || !mainWindow) return;
    bridge.broadcast({
        type: 'app',
        v: 1,
        windowVisible: mainWindow.isVisible()
    });
}

function boundsAreVisible(bounds) {
    if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return false;
    const displays = screen.getAllDisplays();
    return displays.some((display) => {
        const area = display.workArea;
        return bounds.x >= area.x - 40 &&
            bounds.y >= area.y - 40 &&
            bounds.x <= area.x + area.width - 80 &&
            bounds.y <= area.y + area.height - 40;
    });
}

function saveWindowBounds() {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    settings.windowBounds = { x: bounds.x, y: bounds.y };
    saveSettings();
}

function sanitizeToken(value) {
    return typeof value === 'string' ? value.trim().slice(0, 512) : '';
}

function getPluginDirectories() {
    const candidates = [
        path.join(app.getPath('userData'), 'plugins'),
        path.join(app.getAppPath(), 'plugins')
    ];
    return Array.from(new Set(candidates));
}

function emitPluginStatus(status) {
    if (!mainWindow) return;
    mainWindow.webContents.send('plugin-status', status);
}

function queuePluginStatus(status) {
    if (!mainWindow) {
        pluginRuntimeStatusQueue.push(status);
        return;
    }
    emitPluginStatus(status);
}

function emitPluginUi(status) {
    if (!mainWindow) return;
    mainWindow.webContents.send('plugin-ui', status);
}

function queuePluginUi(status) {
    if (!mainWindow) {
        pluginRuntimeUiQueue.push(status);
        return;
    }
    emitPluginUi(status);
}

function flushPluginUiQueue() {
    while (pluginRuntimeUiQueue.length) {
        emitPluginUi(pluginRuntimeUiQueue.shift());
    }
}

function flushPluginStatusQueue() {
    while (pluginRuntimeStatusQueue.length) {
        emitPluginStatus(pluginRuntimeStatusQueue.shift());
    }
}

function setupPlugins() {
    pluginRuntime = createPluginRuntime({
        eventBus: playerStateBus,
        searchDirectories: getPluginDirectories(),
        logger: {
            info: (...args) => console.log('[Plugins]', ...args),
            warn: (...args) => console.warn('[Plugins]', ...args),
            error: (...args) => console.error('[Plugins]', ...args),
            debug: (...args) => console.debug('[Plugins]', ...args)
        },
        onPluginStatus: (status) => {
            queuePluginStatus(status);
            if (status.status === 'failed') {
                console.error(`[Plugins] ${status.name}: ${status.reason || 'failed'}`);
            } else {
                console.log(`[Plugins] ${status.name}: ${status.status}`);
            }
        },
        onPluginUI: (status) => {
            queuePluginUi(status);
            if (status.type === 'panel.mount') {
                if (status.status === 'blocked' || status.status === 'error') {
                    console.warn(`[PluginsUI] ${status.plugin}: ${status.reason || status.error || 'panel mount blocked'}`);
                } else {
                    console.log(`[PluginsUI] panel.mount -> ${status.plugin}#${status.panelId}`);
                }
            }
        }
    });

    pluginRuntime.init();
}

function getExpectedAuthToken() {
    if (envBridgeToken) return envBridgeToken;
    if (settings.bridgeAuthToken) return settings.bridgeAuthToken;
    const generated = crypto.randomBytes(24).toString('hex');
    settings.bridgeAuthToken = generated;
    saveSettings();
    return generated;
}

function playerSizeItems() {
    return [75, 100, 125, 150].map((percent) => ({
        id: 'player-size-' + percent, label: percent + '%', type: 'radio', checked: settings.playerScale === percent,
        click: () => setPlayerSize(percent)
    }));
}

function applyPlayerLayout() {
    if (!mainWindow) return;
    const scale = settings.playerScale / 100;
    const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
    mainWindow.webContents.setZoomFactor(scale);
    mainWindow.setContentSize(
        Math.min(area.width, Math.round((libraryVisible ? 700 : 360) * scale)),
        Math.min(area.height, Math.round((libraryVisible ? 560 : 116) * scale))
    );
    const bounds = mainWindow.getBounds();
    mainWindow.setPosition(
        Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
        Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))
    );
}

function setPlayerSize(percent) {
    if (![75, 100, 125, 150].includes(percent)) return;
    settings.playerScale = percent;
    saveSettings(); applyPlayerLayout(); updateTrayMenu(); updateApplicationMenu();
}

function updateApplicationMenu() {
    const step = (direction) => {
        const sizes = [75, 100, 125, 150];
        setPlayerSize(sizes[Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(settings.playerScale) + direction))]);
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
        { role: 'fileMenu' }, { role: 'editMenu' },
        { label: 'View', submenu: [
            { label: 'Player size', submenu: playerSizeItems() },
            { label: 'Smaller', accelerator: 'CommandOrControl+-', click: () => step(-1) },
            { label: 'Larger', accelerator: 'CommandOrControl+=', click: () => step(1) },
            { label: 'Actual size', accelerator: 'CommandOrControl+0', click: () => setPlayerSize(100) },
            { type: 'separator' }, { role: 'toggleDevTools' }
        ] },
        { role: 'windowMenu' }
    ]));
}

function createWindow() {
    libraryVisible = false;
    const savedBounds = boundsAreVisible(settings.windowBounds) ? settings.windowBounds : {};
    mainWindow = new BrowserWindow({
        x: savedBounds.x,
        y: savedBounds.y,
        width: Math.round(360 * settings.playerScale / 100),
        height: Math.round(116 * settings.playerScale / 100),
        useContentSize: true,
        frame: false,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        backgroundColor: '#000000',
        show: false,
        webPreferences: {
            zoomFactor: settings.playerScale / 100,
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });

    applyPlayerLayout();
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
        callback(contents === mainWindow.webContents && permission === 'geolocation' && details.isMainFrame &&
            details.requestingUrl === pathToFileURL(path.join(__dirname, '../renderer/index.html')).href && Date.now() < radioLocationPermissionUntil);
    });
    mainWindow.webContents.session.setPermissionCheckHandler((contents, permission) =>
        contents === mainWindow.webContents && permission === 'geolocation' && Date.now() < radioLocationPermissionUntil);
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    mainWindow.webContents.on('context-menu', () => {
        Menu.buildFromTemplate([{ label: 'Player size', submenu: playerSizeItems() }]).popup({ window: mainWindow });
    });
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('source-change', activeSource);
        mainWindow.webContents.send('local-catalog', localPlayer.catalog());
        radioPlayer?.publish();
        radioRecorder?.publish();
        if (folderScan) sendFolderNotice('Reading music folders and tags...', true);
        if (activeSource === 'local') {
            // Restoring a window never starts audio by itself.
            localPlayer.select(localPlayer.index, false);
            mainWindow.webContents.send('status-change', 'LOCAL');
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        broadcastVisibility();
        if (pluginRuntime) {
            pluginRuntime.getStatusSnapshot().forEach((status) => {
                emitPluginStatus({
                    ...status,
                    status: status.status || 'active'
                });
            });
        }
        flushPluginStatusQueue();
        flushPluginUiQueue();
    });

    mainWindow.on('show', () => {
        broadcastVisibility();
    });

    mainWindow.on('hide', () => {
        broadcastVisibility();
    });

    mainWindow.on('moved', saveWindowBounds);
    mainWindow.on('move', saveWindowBounds);

    mainWindow.on('close', (event) => {
        saveWindowBounds();
        if (!isQuitting) {
            event.preventDefault();
            hidePlayerWindow();
        }
    });
}

function updateTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        { label: 'YTMamp', enabled: false },
        { type: 'separator' },
        { label: 'Show/Hide', click: () => toggleWindow() },
        { label: 'Player size', submenu: playerSizeItems() },
        { label: 'Add music folders...', click: () => chooseMusicFolder() },
        { label: 'Refresh music library', click: () => changeCollection() },
        { label: 'Playback source', submenu: [
            { label: 'Local files', type: 'radio', checked: activeSource === 'local', click: () => setPlaybackSource('local') },
            { label: 'YouTube Music', type: 'radio', checked: activeSource === 'ytm', click: () => setPlaybackSource('ytm') },
            { label: 'Radio', type: 'radio', checked: activeSource === 'radio', click: () => setPlaybackSource('radio') }
        ] },
        {
            label: 'Copy bridge token',
            click: () => clipboard.writeText(getExpectedAuthToken())
        },
        {
            label: 'Start at login',
            type: 'checkbox',
            checked: settings.startAtLogin,
            click: (item) => {
                settings.startAtLogin = item.checked;
                saveSettings();
                applyAutostart();
                updateTrayMenu();
            }
        },
        {
            label: 'Auto-show on play',
            type: 'checkbox',
            checked: settings.autoShowOnPlay,
            click: (item) => {
                settings.autoShowOnPlay = item.checked;
                saveSettings();
                updateTrayMenu();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit', click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

function createTray() {
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    let icon = nativeImage.createFromPath(iconPath);

    // On macOS, we can use template images for automatic theme support (light/dark menubar)
    if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
    }

    tray = new Tray(icon);

    tray.setToolTip('YTMamp');
    updateTrayMenu();

    tray.on('click', () => {
        if (mainWindow) toggleWindow();
    });
}

function hidePlayerWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    hiddenByUser = true;
    mainWindow.hide();
}

function showPlayerWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    hiddenByUser = false;
    mainWindow.show();
}

function toggleWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
        hidePlayerWindow();
    } else {
        showPlayerWindow();
    }
}

function setupWebSocket() {
    bridge = createBridgeServer({
        port: 18765,
        host: '127.0.0.1',
        allowUnauthenticated: localTrustEnabled,
        expectedAuthToken: localTrustEnabled ? '' : getExpectedAuthToken(),
        authTimeoutMs: 7000,
        onStatus: (status) => {
            if (status === 'listening') console.log('[WS] Server started on ws://127.0.0.1:18765');
            if (status !== 'listening') ytmStatus = status;
            if (activeSource === 'ytm') appStatus = ytmStatus;
        },
        onConnection: (ws, req) => {
            const clientIp = req.socket.remoteAddress;
            console.log(`[WS] Client connected from ${clientIp}`);
            ws.send(JSON.stringify({ type: 'settings', v: 1, settings }));
            if (mainWindow) {
                ws.send(JSON.stringify({
                    type: 'app',
                    v: 1,
                    windowVisible: mainWindow.isVisible()
                }));
            }
        },
        onMessage: (message, ws) => {
            if (message.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', v: 1 }));
            } else if (message.type === 'cmd' && message.cmd === 'showWindow') {
                if (mainWindow) {
                    showPlayerWindow();
                    mainWindow.setAlwaysOnTop(true);
                    mainWindow.focus();
                }
            } else if (message.type === 'cmd' && message.cmd === 'hideWindow') {
                hidePlayerWindow();
            } else if (message.type === 'event' && message.name === 'playingStarted' && activeSource === 'ytm') {
                console.log('[Main] Received playingStarted event');
                if (settings.autoShowOnPlay && !hiddenByUser && mainWindow && !mainWindow.isVisible()) {
                    console.log('[Main] Auto-showing window due to playback');
                    mainWindow.show();
                }
            } else if (message.type === 'set-setting') {
                settings[message.key] = message.value;
                saveSettings();
                console.log(`[Main] Setting updated: ${message.key} = ${message.value}`);
                broadcastSettings();
                updateTrayMenu();
            } else if (message.type === 'get-settings') {
                ws.send(JSON.stringify({ type: 'settings', v: 1, settings }));
            } else if (message.type === 'status') {
                ytmStatus = message.msg || ytmStatus;
                if (/OFFLINE|NEED|WAITING/i.test(ytmStatus)) {
                    ytmSnapshot.track = null;
                    ytmSnapshot.state = null;
                }
                if (activeSource === 'ytm') {
                    appStatus = ytmStatus;
                    if (!ytmSnapshot.track) publishPlayerEvent('track', null, { dedupeMs: 0 });
                    if (mainWindow) mainWindow.webContents.send('status-change', message.msg);
                }
            } else if (message.type === 'track') {
                ytmSnapshot.track = message;
                if (activeSource === 'ytm') publishTrack(message);
            } else if (message.type === 'volStatus') {
                if (activeSource === 'ytm' && mainWindow) mainWindow.webContents.send('vol-status', message.status);
            } else if (message.type === 'state') {
                ytmSnapshot.state = message;
                if (activeSource === 'ytm') publishState(message);
            } else if ((message.type === 'wave' || message.type === 'waveFallback')) {
                if (activeSource === 'ytm' && mainWindow) mainWindow.webContents.send('wave-update', message);
            }
        },
        onError: (error) => console.error('[WS] Error:', error.message)
    });
    bridge.start();
}

function sendPlayerCommand(command) {
    if (activeSource === 'local') return localPlayer.command(command);
    if (activeSource === 'radio') return radioPlayer.command(command);
    return !!(bridge && bridge.relayCommand(command));
}

function setPlaybackSource(source) {
    if (!['local', 'ytm', 'radio'].includes(source) || source === activeSource) return;
    if (activeSource === 'local') localPlayer.pause();
    else if (activeSource === 'radio') {
        radioPlayer.pause();
        if (radioRecorder.recording) { radioRecorder.stop(); saveRadioRecording().catch(() => radioRecorder.publish('Recording is unsaved. Open RADIO / LIBRARY to save it.')); }
    } else if (ytmSnapshot.state?.playing && bridge) {
        bridge.relayCommand({ v: 1, type: 'cmd', cmd: 'pause', id: `source-${Date.now()}` });
    }
    activeSource = source;
    appStatus = source === 'local' ? 'LOCAL' : source === 'radio' ? 'RADIO' : ytmStatus;
    if (mainWindow) {
        mainWindow.webContents.send('source-change', source);
        mainWindow.webContents.send('status-change', appStatus);
        mainWindow.webContents.send('wave-update', { type: 'waveFallback', reason: 'Source changed' });
    }
    if (source === 'local') localPlayer.publish();
    else if (source === 'radio') radioPlayer.publish();
    else {
        publishPlayerEvent('track', ytmSnapshot.track ? sanitizeTrackMessage(ytmSnapshot.track) : null, { dedupeMs: 0 });
        publishState(ytmSnapshot.state || { playing: false });
        openYtmIfNeeded();
    }
    updateTrayMenu();
}

function openYtmIfNeeded(force = false) {
    const connected = /connected/i.test(ytmStatus) && !!ytmSnapshot.track;
    launchYtm({ connected, force }).catch((error) => mainWindow?.webContents.send('source-notice', error.message));
}

function sendFolderNotice(message, busy = false) {
    if (mainWindow) mainWindow.webContents.send('folder-notice', { message, busy });
}

async function ensureCollection() {
    collectionReady ||= collection.load(typeof settings.localFolder === 'string' ? settings.localFolder : '');
    await collectionReady;
}

async function changeCollection(folders = [], { restore = false, removeId = '' } = {}) {
    if (folderScan) return;
    const controller = new AbortController();
    folderScan = controller;
    sendFolderNotice('Reading music folders and tags...', true);
    try {
        await ensureCollection();
        const library = await collection.update({ folders, removeId, signal: controller.signal,
            onProgress: ({ processed, folder }) => sendFolderNotice('Reading tags: ' + processed + ' tracks, ' + folder, true) });
        controller.signal.throwIfAborted();
        if (folders.length && !restore) setPlaybackSource('local');
        localPlayer.setLibrary(library, settings.localTrackId, { preservePlayback: true });
        settings.localFolder = collection.roots[0]?.path || '';
        settings.localTrackId = localPlayer.current?.id || '';
        saveSettings();
        const offline = library.roots.filter((root) => root.status === 'offline').length;
        let message = library.tracks.length + ' tracks in ' + library.roots.length + ' folders.';
        if (offline) message += ' ' + offline + ' folders offline. Reconnect and refresh.';
        if (library.limited) message += ' Library limit reached.';
        if (library.skipped) message += ' ' + library.skipped + ' inaccessible entries skipped.';
        sendFolderNotice(message);
    } catch (error) {
        if (controller.signal.aborted) sendFolderNotice('Library update canceled.');
        else sendFolderNotice(error.code ? 'Cannot read the folder. Reconnect the drive and try again.' : error.message);
    } finally {
        if (folderScan === controller) folderScan = null;
    }
}

async function restoreLibrary() {
    try {
        await ensureCollection();
        localPlayer.setLibrary(collection.snapshot(), settings.localTrackId);
        await changeCollection([], { restore: true });
    } catch {
        sendFolderNotice('Cannot restore the library. Add your music folders again.');
    }
}

async function chooseMusicFolder() {
    if (choosingFolder || folderScan) return;
    choosingFolder = true;
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Add music folders', properties: ['openDirectory', 'multiSelections'],
            ...(typeof settings.localFolder === 'string' && settings.localFolder ? { defaultPath: settings.localFolder } : {})
        });
        if (!result.canceled && result.filePaths.length) await changeCollection(result.filePaths);
    } finally {
        choosingFolder = false;
    }
}

function setupLocalPlayback() {
    collection = new LocalCollection({ directory: app.getPath('userData') });
    radioLibrary = new RadioLibrary({ directory: app.getPath('userData') });
    radioPlayer = new RadioPlayer({ library: radioLibrary, volume: Number.isFinite(settings.radioVolume) ? Math.max(0, Math.min(1, settings.radioVolume)) : 0.5 });
    radioRecorder = new RadioRecorder({ directory: app.getPath('userData') });
    radioPlayer.on('audio', (command) => mainWindow?.webContents.send('radio-audio-command', command));
    radioPlayer.on('selection', (value) => mainWindow?.webContents.send('radio-selection', value));
    radioPlayer.on('track', (track) => { if (activeSource === 'radio') publishPlayerEvent('track', track, { dedupeMs: 0 }); });
    radioPlayer.on('state', (state) => { if (activeSource === 'radio') publishState(state); });
    radioPlayer.on('volume', (volume) => { settings.radioVolume = volume; saveSettings(); });
    radioRecorder.on('status', (state) => mainWindow?.webContents.send('radio-recording', state));
    localPlayer.volume = Number.isFinite(settings.localVolume) ? Math.max(0, Math.min(1, settings.localVolume)) : 0.5;
    const localMedia = createLocalMediaHandler((id, kind) => {
        if (kind === 'art') return collection.artwork(id);
        const item = localPlayer.library.tracks.find((track) => track.id === id && track.available !== false);
        return item ? { ...item, root: item.root || localPlayer.library.root } : null;
    });
    const radioMedia = createRadioMediaHandler((id) => radioLibrary.stations.get(id));
    protocol.handle('ytmamp-media', (request) => /^ytmamp-media:\/\/radio(?:-art|-check)?\//.test(request.url) ? radioMedia(request) : localMedia(request));
    localPlayer.on('audio', (command) => mainWindow?.webContents.send('local-audio-command', command));
    localPlayer.on('catalog', (catalog) => mainWindow?.webContents.send('local-catalog', catalog));
    localPlayer.on('selection', (selection) => {
        mainWindow?.webContents.send('local-selection', selection);
        if (selection.id && settings.localTrackId !== selection.id) {
            settings.localTrackId = selection.id;
            saveSettings();
        }
    });
    localPlayer.on('track', (track) => {
        if (activeSource === 'local') publishPlayerEvent('track', track, { dedupeMs: 0 });
    });
    localPlayer.on('state', (state) => { if (activeSource === 'local') publishState(state); });
    localPlayer.on('volume', (volume) => { settings.localVolume = volume; saveSettings(); });
}

function isPlayerSender(event) {
    return !!mainWindow && event.sender === mainWindow.webContents &&
        event.senderFrame?.url === pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
}

async function saveRadioRecording() {
    if (radioSaving || !radioRecorder.pending) return;
    radioSaving = true;
    try {
        const pending = radioRecorder.pending;
        const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const result = await dialog.showSaveDialog(mainWindow, { title: 'Save radio recording', defaultPath: pending.name + ' ' + date + '.wav', filters: [{ name: 'WAV audio', extensions: ['wav'] }], properties: ['showOverwriteConfirmation'] });
        if (!result.canceled && result.filePath) await radioRecorder.save(result.filePath);
        else radioRecorder.publish('Recording kept. Use Save as or Discard in RADIO / LIBRARY.');
    } finally { radioSaving = false; }
}

async function radioAction(event, action, data = {}) {
    if (!isPlayerSender(event) || typeof action !== 'string' || !data || typeof data !== 'object') return { error: 'Invalid radio request.' };
    try {
        if (action === 'snapshot') return radioLibrary.snapshot();
        if (action === 'search') return await radioLibrary.search(data);
        if (action === 'stream-check') {
            if (activeSource !== 'radio' || typeof data.ok !== 'boolean' || !radioLibrary.stations.has(data.id)) return { error: 'Invalid station check.' };
            if (data.ok) radioLibrary.markSuccessful(data.id); else radioLibrary.markFailed(data.id);
            return { ok: true, alternate: data.ok ? null : radioLibrary.alternatives(data.id).map((station) => radioLibrary.public(station))[0] || null };
        }
        if (action === 'device-location') {
            if (process.platform !== 'darwin') { radioLocationPermissionUntil = Date.now() + 20000; return { browser: true }; }
            if (radioActionBusy) return { error: 'Finding the device location. Please wait.' };
            radioActionBusy = true;
            try {
                const location = await locateMac({ appPath: app.getAppPath(), packaged: app.isPackaged });
                const result = await radioLibrary.chooseLocation(location); radioPlayer.publish(); return result;
            } finally { radioActionBusy = false; }
        }
        if (action === 'location') {
            if (radioActionBusy) return { error: 'Location lookup is already running.' };
            radioActionBusy = true;
            try { const result = await radioLibrary.chooseLocation(data); radioPlayer.publish(); return result; } finally { radioActionBusy = false; }
        }
        if (action === 'custom') return { id: radioLibrary.addCustom(data) };
        if (action === 'favorite') { radioLibrary.toggleFavorite(data.id); radioPlayer.publish(); return { ok: true }; }
        if (action === 'frequency') { radioLibrary.setFrequency(data.id, data.value); radioPlayer.publish(); return { ok: true }; }
        if (action === 'play' || action === 'tune') {
            if (activeSource !== 'radio') return { error: 'Select RADIO first.' };
            if (data.retry === true) radioLibrary.retryStation(data.id);
            if (action === 'tune' && !radioLibrary.local().some((station) => station.id === data.id)) return { error: 'Not a local FM station.' };
            if (!radioPlayer.select(data.id, { tuning: action === 'tune' })) return { error: 'This station has no supported direct stream. Choose another station.' };
            if (action === 'play') radioLibrary.browser.click(radioPlayer.current.uuid);
            return { ok: true };
        }
        if (action === 'record') {
            if (data.action === 'start') {
                if (activeSource !== 'radio' || !radioPlayer.state.playing) return { error: 'Start radio playback before recording.' };
                radioRecorder.start(radioPlayer.current?.name);
            } else if (data.action === 'pause') radioRecorder.togglePause();
            else if (data.action === 'stop') { radioRecorder.stop(); await saveRadioRecording(); }
            else if (data.action === 'save') await saveRadioRecording();
            else if (data.action === 'discard' && !radioSaving) radioRecorder.discard();
            else return { error: 'Invalid recording action.' };
            return radioRecorder.status();
        }
        return { error: 'Unknown radio request.' };
    } catch (error) { return { error: String(error.message || 'Radio request failed.').slice(0, 200) }; }
}

function setupIpc() {
    ipcMain.on('open-ytm', (event) => { if (isPlayerSender(event)) openYtmIfNeeded(true); });
    ipcMain.handle('radio-action', radioAction);
    ipcMain.on('radio-audio-report', (event, report) => { if (isPlayerSender(event) && activeSource === 'radio') radioPlayer.receive(report); });
    let lastRecordingStatus = 0;
    ipcMain.on('radio-record-chunk', (event, data) => {
        if (!isPlayerSender(event) || activeSource !== 'radio') return;
        radioRecorder.chunk(data);
        if (Date.now() - lastRecordingStatus >= 1000) { lastRecordingStatus = Date.now(); radioRecorder.publish(); }
    });
    ipcMain.on('send-command', (event, command) => {
        if (!isPlayerSender(event) || !validateMessage(command)) {
            console.warn('[Main] Dropping invalid renderer command');
            return;
        }
        if (sendPlayerCommand(command)) {
            console.log(`[Main] [ID:${command.id || 'N/A'}] Relaying CMD to WS: ${command.cmd}`);
        } else {
            console.warn(`[Main] [ID:${command.id || 'N/A'}] Drop: no active WS client`);
        }
    });

    ipcMain.on('set-source', (event, source) => { if (isPlayerSender(event)) setPlaybackSource(source); });
    ipcMain.on('open-music-folder', (event) => { if (isPlayerSender(event)) chooseMusicFolder().catch(() => sendFolderNotice('Could not open the folder picker.')); });
    ipcMain.on('cancel-folder-scan', (event) => {
        if (isPlayerSender(event) && folderScan) folderScan.abort();
    });
    ipcMain.on('refresh-library', (event) => { if (isPlayerSender(event)) changeCollection(); });
    ipcMain.on('remove-library-folder', (event, id) => {
        if (isPlayerSender(event) && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) changeCollection([], { removeId: id });
    });
    ipcMain.on('play-local-album', (event, id) => {
        if (isPlayerSender(event) && activeSource === 'local' && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) localPlayer.playAlbum(id);
    });
    ipcMain.on('select-local-track', (event, id, albumId) => {
        if (!isPlayerSender(event) || activeSource !== 'local' || typeof id !== 'string') return;
        localPlayer.playTrack(id, typeof albumId === 'string' ? albumId : '');
    });
    ipcMain.on('local-audio-report', (event, report) => {
        if (isPlayerSender(event) && activeSource === 'local') localPlayer.receive(report);
    });
    ipcMain.on('set-queue-visible', (event, visible) => {
        if (!isPlayerSender(event) || typeof visible !== 'boolean') return;
        libraryVisible = visible;
        applyPlayerLayout();
    });

    ipcMain.on('quit-app', () => {
        isQuitting = true;
        app.quit();
    });

    ipcMain.on('hide-window', (event) => {
        if (isPlayerSender(event)) hidePlayerWindow();
    });
}

app.whenReady().then(() => {
    loadSettings();
    applyAutostart();
    setupPlugins();
    setupLastFmScrobbling();
    setupLocalPlayback();
    createWindow();
    createTray();
    updateApplicationMenu();
    setupIpc();
    configurePlayerCastBridge({
        getPlayerSnapshot: () => ({
            track: playerState.track,
            state: playerState.state
        }),
        sendPlayerAction: (command) => {
            const sent = sendPlayerCommand({
                v: 1,
                type: 'cmd',
                id: `cast-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                cmd: command
            });
            return sent ? { ok: true } : { ok: false, error: 'command_send_failed' };
        }
    });
    setupIntegrationServer();
    setupWebSocket();
    restoreLibrary();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else showPlayerWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
    if (!radioQuitAccepted && (radioRecorder?.recording || radioRecorder?.pending)) {
        event.preventDefault();
        if (!radioQuitPrompt) {
            radioQuitPrompt = true;
            radioRecorder.stop();
            saveRadioRecording().then(() => {
                if (!radioRecorder.pending) { radioQuitAccepted = true; app.quit(); }
                else { isQuitting = false; showPlayerWindow(); }
            }).catch(() => { isQuitting = false; showPlayerWindow(); }).finally(() => { radioQuitPrompt = false; });
        }
        return;
    }
    isQuitting = true;
    radioPlayer?.close();
    if (folderScan) folderScan.abort();
    collection?.close();
    if (lastfmScrobbler) {
        lastfmScrobbler.stop();
    }
    if (integrationServer) {
        for (const client of integrationSseClients) {
            try {
                client.end();
            } catch (error) {
                // ignore
            }
        }
        integrationSseClients.clear();
        integrationRateBuckets.clear();
        integrationServer.close();
        integrationServer = undefined;
    }
    if (bridge) bridge.stop();
    if (tray) tray.destroy();
    if (pluginRuntime) pluginRuntime.unload();
});
