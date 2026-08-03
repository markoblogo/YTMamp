const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { createBridgeServer, sanitizeTrackMessage, validateMessage } = require('./ws_bridge');
const { createEventBus } = require('./event_bus');
const { createPluginRuntime } = require('./plugin_runtime');

let mainWindow;
let tray;
let bridge;
let isQuitting = false;
let pluginRuntime;
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
const INTEGRATION_HOST = '127.0.0.1';
const INTEGRATION_PORT = Number(process.env.INTEGRATION_PORT) || 18880;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const MAX_SSE_CLIENTS = 25;
let integrationServer;
const integrationSseClients = new Set();
const integrationRateBuckets = new Map();
let appStatus = 'OFFLINE';

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
});

playerStateBus.on('state', (payload) => {
    if (mainWindow) {
        mainWindow.webContents.send('state-update', payload);
    }
    broadcastIntegrationEvent('state', payload);
});

function parseRemoteIp(req) {
    const raw = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
    if (raw === '::1') return '127.0.0.1';
    return raw.startsWith('::ffff:') ? raw.replace('::ffff:', '') : raw;
}

function isLocalRequest(req) {
    const ip = parseRemoteIp(req);
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function isAuthorizedIntegrationRequest(req, queryToken) {
    if (!integrationEnvToken) return true;
    const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const xToken = (req.headers['x-ytmamp-token'] || '').trim();
    const token = queryToken || headerToken || xToken;
    return token === integrationEnvToken;
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
        v: 1,
        status: appStatus,
        track: playerState.track,
        state: playerState.state,
        updatedAt: playerState.lastTs || 0,
        windowVisible: !!(mainWindow && mainWindow.isVisible())
    };
}

function formatJsonResponse(res, statusCode, payload) {
    const json = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(json)
    });
    res.end(json);
}

function broadcastIntegrationEvent(name, payload) {
    if (!integrationSseClients.size) return;
    const body = JSON.stringify({
        type: name,
        v: 1,
        payload
    });
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
        try {
            if (!req.url) {
                res.writeHead(400);
                res.end('bad request');
                return;
            }

            if (!isLocalRequest(req)) {
                res.writeHead(403, {
                    'content-type': 'text/plain; charset=utf-8'
                });
                res.end('forbidden');
                return;
            }

            const parsedUrl = new URL(req.url, `http://${INTEGRATION_HOST}:${INTEGRATION_PORT}`);
            const query = parsedUrl.searchParams;
            const token = query.get('token');

            if (!isAuthorizedIntegrationRequest(req, token)) {
                res.writeHead(401, {
                    'www-authenticate': 'Bearer realm="ytmamp-local"',
                    'content-type': 'text/plain; charset=utf-8'
                });
                res.end('unauthorized');
                return;
            }

            const bucket = getRateBucket(parseRemoteIp(req));
            if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
                res.writeHead(429, {
                    'retry-after': String(getRetryAfterMs(bucket)),
                    'content-type': 'text/plain; charset=utf-8'
                });
                res.end('rate limit exceeded');
                return;
            }

            if (req.method === 'GET' && parsedUrl.pathname === '/status') {
                formatJsonResponse(res, 200, {
                    ...createCanonicalPayload()
                });
                return;
            }

            if (req.method === 'GET' && parsedUrl.pathname === '/current-track') {
                if (!playerState.track) {
                    res.writeHead(204, { 'cache-control': 'no-store' });
                    res.end();
                    return;
                }

                formatJsonResponse(res, 200, {
                    ...createCanonicalPayload(),
                    track: playerState.track
                });
                return;
            }

            if (parsedUrl.pathname === '/events' && req.method === 'GET') {
                if (integrationSseClients.size >= MAX_SSE_CLIENTS) {
                    res.writeHead(429, {
                        'content-type': 'text/plain; charset=utf-8',
                        'retry-after': '1'
                    });
                    res.end('too many SSE clients');
                    return;
                }

                res.writeHead(200, {
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-store',
                    connection: 'keep-alive',
                    'x-accel-buffering': 'no'
                });
                res.write(': connected\n\n');
                const payload = JSON.stringify({
                    type: 'snapshot',
                    v: 1,
                    payload: createCanonicalPayload()
                });
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
        } catch (error) {
            console.error('[LocalAPI] request error:', error.message);
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('internal error');
        }
    });

    integrationServer.on('error', (error) => {
        console.error('[LocalAPI] server error:', error.message);
    });

    integrationServer.listen(INTEGRATION_PORT, INTEGRATION_HOST, () => {
        console.log(`[LocalAPI] listening on http://${INTEGRATION_HOST}:${INTEGRATION_PORT}`);
        console.log('[LocalAPI] endpoints: /status, /current-track, /events');
    });
}

// --- Settings Persistence ---
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = {
    startAtLogin: false,
    autoShowOnPlay: true,
    windowBounds: null,
    bridgeAuthToken: ''
};

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
            settings.startAtLogin = typeof settings.startAtLogin === 'boolean' ? settings.startAtLogin : !!settings.startAtLogin;
            settings.autoShowOnPlay = typeof settings.autoShowOnPlay === 'boolean' ? settings.autoShowOnPlay : true;
            settings.bridgeAuthToken = (typeof settings.bridgeAuthToken === 'string' && settings.bridgeAuthToken.length <= 512) ? settings.bridgeAuthToken : '';
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

function createWindow() {
    const savedBounds = boundsAreVisible(settings.windowBounds) ? settings.windowBounds : {};
    mainWindow = new BrowserWindow({
        x: savedBounds.x,
        y: savedBounds.y,
        width: 360,
        height: 116,
        useContentSize: true,
        frame: false,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        backgroundColor: '#000000',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

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
            mainWindow.hide();
        }
    });
}

function updateTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        { label: 'YTMamp', enabled: false },
        { type: 'separator' },
        { label: 'Show/Hide', click: () => toggleWindow() },
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

function toggleWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        mainWindow.show();
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
            appStatus = status === 'listening' ? 'CONNECTED' : status;
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
                    mainWindow.show();
                    mainWindow.setAlwaysOnTop(true);
                    mainWindow.focus();
                }
            } else if (message.type === 'cmd' && message.cmd === 'hideWindow') {
                if (mainWindow) mainWindow.hide();
            } else if (message.type === 'event' && message.name === 'playingStarted') {
                console.log('[Main] Received playingStarted event');
                if (settings.autoShowOnPlay && mainWindow && !mainWindow.isVisible()) {
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
                appStatus = message.msg || appStatus;
                if (mainWindow) mainWindow.webContents.send('status-change', message.msg);
            } else if (message.type === 'track') {
                publishTrack(message);
            } else if (message.type === 'volStatus') {
                if (mainWindow) mainWindow.webContents.send('vol-status', message.status);
            } else if (message.type === 'state') {
                publishState(message);
            } else if ((message.type === 'wave' || message.type === 'waveFallback')) {
                if (mainWindow) mainWindow.webContents.send('wave-update', message);
            }
        },
        onError: (error) => console.error('[WS] Error:', error.message)
    });
    bridge.start();
}

function setupIpc() {
    ipcMain.on('send-command', (event, command) => {
        if (!validateMessage(command)) {
            console.warn('[Main] Dropping invalid renderer command');
            return;
        }
        if (bridge && bridge.relayCommand(command)) {
            console.log(`[Main] [ID:${command.id || 'N/A'}] Relaying CMD to WS: ${command.cmd}`);
        } else {
            console.warn(`[Main] [ID:${command.id || 'N/A'}] Drop: no active WS client`);
        }
    });

    ipcMain.on('quit-app', () => {
        isQuitting = true;
        app.quit();
    });

    ipcMain.on('hide-window', () => {
        if (mainWindow) mainWindow.hide();
    });
}

app.whenReady().then(() => {
    loadSettings();
    applyAutostart();
    setupPlugins();
    createWindow();
    createTray();
    setupIpc();
    setupIntegrationServer();
    setupWebSocket();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else mainWindow.show();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    isQuitting = true;
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
