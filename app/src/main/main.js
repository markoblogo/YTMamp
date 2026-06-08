const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { createBridgeServer, sanitizeTrackMessage, validateMessage } = require('./ws_bridge');

let mainWindow;
let tray;
let bridge;
let isQuitting = false;

// --- Settings Persistence ---
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = {
    startAtLogin: false,
    autoShowOnPlay: true,
    windowBounds: null
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
    if (process.platform === 'darwin' || process.platform === 'win32') {
        app.setLoginItemSettings({
            openAtLogin: settings.startAtLogin,
            openAsHidden: false,
            path: app.getPath('exe')
        });
        console.log(`[Main] Autostart set to: ${settings.startAtLogin}`);
    } else if (process.platform === 'linux') {
        applyLinuxAutostart();
    }
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
        onStatus: (status) => {
            if (status === 'listening') console.log('[WS] Server started on ws://127.0.0.1:18765');
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
                if (mainWindow) mainWindow.webContents.send('status-change', message.msg);
            } else if (message.type === 'track') {
                if (mainWindow) mainWindow.webContents.send('track-update', sanitizeTrackMessage(message));
            } else if (message.type === 'volStatus') {
                if (mainWindow) mainWindow.webContents.send('vol-status', message.status);
            } else if (message.type === 'state') {
                if (mainWindow) mainWindow.webContents.send('state-update', message);
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
    createWindow();
    createTray();
    setupIpc();
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
    if (bridge) bridge.stop();
    if (tray) tray.destroy();
});
