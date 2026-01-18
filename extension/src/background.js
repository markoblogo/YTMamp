let socket = null;
let isConnected = false;
let isConnecting = false;
let autoConnect = true;

// Load settings
chrome.storage.sync.get({ autoConnect: true }, (data) => {
    autoConnect = data.autoConnect;
    if (autoConnect) setupWebSocket();
});

function checkTabStatus() {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
        if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
            if (tabs.length > 0) {
                // Relaying success to Electron
                socket.send(JSON.stringify({ type: 'status', v: 1, msg: 'Client connected' }));
            } else {
                // Relaying failure
                socket.send(JSON.stringify({ type: 'status', v: 1, msg: 'Need YTM Tab' }));
                chrome.runtime.sendMessage({ type: 'status', v: 1, msg: 'Need YTM Tab' }).catch(() => { });
            }
        }
    });
}

function setupWebSocket(isRetry = false) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    if (isConnecting) return;

    isConnecting = true;
    if (!isRetry) console.log('[Extension] Attempting connection...');

    // Status update for popup
    chrome.runtime.sendMessage({ type: 'status', v: 1, msg: 'WAITING' }).catch(() => { });

    socket = new WebSocket('ws://127.0.0.1:18765');

    socket.onopen = () => {
        isConnected = true;
        isConnecting = false;
        console.log('[Extension] Connected to Electron app');
        chrome.runtime.sendMessage({ type: 'status', v: 1, msg: 'CONNECTED' }).catch(() => { });
        // Immediately check tab after connection
        setTimeout(checkTabStatus, 500);
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);

            // Handle app status updates (visibility, etc)
            if (message.type === 'app') {
                lastAppStatus.windowVisible = message.windowVisible;
                chrome.runtime.sendMessage({ type: 'app', v: 1, windowVisible: message.windowVisible }).catch(() => { });
                return;
            }

            // Relay commands from Electron to YTM tabs
            if (message.type === 'cmd') {
                console.log(`[Extension] [ID:${message.id || 'N/A'}] Relaying CMD: ${message.cmd}`);
            }

            chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
                if (tabs.length > 0) {
                    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, message));
                } else {
                    if (message.type === 'cmd') console.warn(`[Extension] [ID:${message.id || 'N/A'}] Drop: No YTM Tab`);
                    chrome.runtime.sendMessage({ type: 'status', v: 1, msg: 'Need YTM Tab' }).catch(() => { });
                }
            });
        } catch (e) {
            console.error('[Extension] Failed to parse message:', e);
        }
    };

    socket.onclose = () => {
        isConnected = false;
        isConnecting = false;
        socket = null;
        chrome.runtime.sendMessage({ type: 'status', v: 1, msg: 'OFFLINE' }).catch(() => { });

        if (autoConnect) {
            setTimeout(() => setupWebSocket(true), 2000);
        }
    };

    socket.onerror = (err) => {
        isConnecting = false;
    };
}

// Global listeners (outside setupWebSocket)

// 1. Tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('music.youtube.com')) {
        if (autoConnect && !isConnected) {
            setupWebSocket();
        } else if (isConnected) {
            checkTabStatus();
        }
    }
});

let lastAppStatus = { windowVisible: false };

// 2. Messages from Popup/Content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.v !== 1 && !message.type) return;

    // Status request from Popup
    if (message.type === 'get_status') {
        sendResponse({
            connected: isConnected,
            waiting: isConnecting,
            autoConnect: autoConnect,
            windowVisible: lastAppStatus.windowVisible
        });
        return;
    }

    // Settings toggle
    if (message.type === 'toggle_auto') {
        autoConnect = message.value;
        if (autoConnect) setupWebSocket();
        return;
    }

    // Manual connect
    if (message.type === 'manual_connect') {
        autoConnect = true;
        chrome.storage.sync.set({ autoConnect: true });
        setupWebSocket();
        return;
    }

    // Manual disconnect
    if (message.type === 'manual_disconnect') {
        autoConnect = false;
        chrome.storage.sync.set({ autoConnect: false });
        if (socket) socket.close();
        return;
    }

    // Show/Hide Player command (from Popup)
    if (message.type === 'cmd' && (message.cmd === 'showWindow' || message.cmd === 'hideWindow')) {
        if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'cmd', cmd: message.cmd, v: 1 }));
        }
        return;
    }

    // Open YTM command (from Popup)
    if (message.type === 'open_ytm') {
        chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
            if (tabs.length > 0) {
                const tab = tabs[0];
                chrome.tabs.update(tab.id, { active: true });
                chrome.windows.update(tab.windowId, { focused: true });
            } else {
                chrome.tabs.create({ url: 'https://music.youtube.com/' });
            }
        });
        return;
    }

    // Relay other messages (state, track, wave, settings, event)
    if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
        const relayTypes = ['track', 'wave', 'waveFallback', 'volStatus', 'state', 'event', 'settings'];
        if (relayTypes.includes(message.type)) {
            socket.send(JSON.stringify(message));
        }
    }
});
