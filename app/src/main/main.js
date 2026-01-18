const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

let mainWindow;
let tray;
let wss;
let isQuitting = false;

// --- Settings Persistence ---
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = {
    startAtLogin: false,
    autoShowOnPlay: true
};

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
        }
    } catch (e) {
        console.error('[Main] Failed to load settings:', e);
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('[Main] Failed to save settings:', e);
    }
}

function applyAutostart() {
    if (process.platform === 'darwin' || process.platform === 'win32') {
        app.setLoginItemSettings({
            openAtLogin: settings.startAtLogin,
            path: app.getPath('exe')
        });
        console.log(`[Main] Autostart set to: ${settings.startAtLogin}`);
    }
}

function broadcastSettings() {
    if (!wss) return;
    const msg = JSON.stringify({ type: 'settings', v: 1, settings });
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // 1 = OPEN
            client.send(msg);
        }
    });
}

function broadcastVisibility() {
    if (!wss || !mainWindow) return;
    const msg = JSON.stringify({
        type: 'app',
        v: 1,
        windowVisible: mainWindow.isVisible()
    });
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(msg);
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
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
    });

    mainWindow.on('show', () => {
        broadcastVisibility();
    });

    mainWindow.on('hide', () => {
        broadcastVisibility();
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function createTray() {
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    let icon = nativeImage.createFromPath(iconPath);

    // On macOS, we can use template images for automatic theme support (light/dark menubar)
    if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
    }

    tray = new Tray(icon);

    const updateTrayMenu = () => {
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
                }
            },
            {
                label: 'Auto-show on play',
                type: 'checkbox',
                checked: settings.autoShowOnPlay,
                click: (item) => {
                    settings.autoShowOnPlay = item.checked;
                    saveSettings();
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
    };

    tray.setToolTip('YTMamp');
    updateTrayMenu();

    tray.on('click', () => {
        toggleWindow();
    });
}

function toggleWindow() {
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        mainWindow.show();
    }
}

function setupWebSocket() {
    wss = new WebSocketServer({ port: 18765, host: '127.0.0.1' });
    console.log('[WS] Server started on ws://127.0.0.1:18765');

    wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        console.log(`[WS] Client connected from ${clientIp}`);

        // Send current settings and visibility on connection
        ws.send(JSON.stringify({ type: 'settings', v: 1, settings }));
        if (mainWindow) {
            ws.send(JSON.stringify({
                type: 'app',
                v: 1,
                windowVisible: mainWindow.isVisible()
            }));
        }

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                if (message.v !== 1) return;

                if (message.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', v: 1 }));
                } else if (message.type === 'cmd' && message.cmd === 'showWindow') {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.setAlwaysOnTop(true);
                        mainWindow.focus();
                    }
                } else if (message.type === 'cmd' && message.cmd === 'hideWindow') {
                    if (mainWindow) {
                        mainWindow.hide();
                    }
                } else if (message.type === 'event' && message.name === 'playingStarted') {
                    console.log('[Main] Received playingStarted event');
                    if (settings.autoShowOnPlay && mainWindow && !mainWindow.isVisible()) {
                        console.log('[Main] Auto-showing window due to playback');
                        mainWindow.show();
                    }
                } else if (message.type === 'set-setting') {
                    if (message.key in settings) {
                        settings[message.key] = message.value;
                        saveSettings();
                        console.log(`[Main] Setting updated: ${message.key} = ${message.value}`);
                        // Broadcast updated settings to ALL clients
                        broadcastSettings();
                        // Update tray menu to reflect changes if needed
                        if (message.key === 'autoShowOnPlay' || message.key === 'startAtLogin') {
                            createTray(); // Refresh menu
                        }
                    }
                } else if (message.type === 'get-settings') {
                    ws.send(JSON.stringify({ type: 'settings', v: 1, settings }));
                } else if (message.type === 'status') {
                    if (mainWindow) mainWindow.webContents.send('status-change', message.msg);
                } else if (message.type === 'track') {
                    if (mainWindow) mainWindow.webContents.send('track-update', message);
                } else if (message.type === 'volStatus') {
                    if (mainWindow) {
                        mainWindow.webContents.send('vol-status', message.status);
                    }
                } else if (message.type === 'state') {
                    if (mainWindow) mainWindow.webContents.send('state-update', message);
                } else if ((message.type === 'wave' || message.type === 'waveFallback')) {
                    if (mainWindow) mainWindow.webContents.send('wave-update', message);
                }
            } catch (e) {
                console.error('[WS] Failed to parse message:', data.toString());
            }
        });

        const cmdHandler = (event, command) => {
            if (ws.readyState === ws.OPEN) {
                console.log(`[Main] [ID:${command.id || 'N/A'}] Relaying CMD to WS: ${command.cmd}`);
                ws.send(JSON.stringify(command));
            } else {
                console.warn(`[Main] [ID:${command.id || 'N/A'}] Drop: WS not open`);
            }
        };
        ipcMain.on('send-command', cmdHandler);

        ws.on('close', () => {
            ipcMain.removeListener('send-command', cmdHandler);
        });
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
    createWindow();
    createTray();
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
});
