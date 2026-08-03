let socket = null;
let isConnected = false;
let isAuthenticated = false;
let isConnecting = false;
let autoConnect = true;
const WS_ENDPOINT = 'ws://127.0.0.1:18765';
const WS_RETRY_BASE_MS = 800;
const WS_RETRY_MAX_MS = 12000;
const WS_HEARTBEAT_MS = 15000;
const WS_HEARTBEAT_TIMEOUT_MS = 5000;
let reconnectAttempt = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let heartbeatTimeout = null;
let manualDisconnect = false;
let reconnectScheduled = false;
let bridgeAuthToken = '';

function getSocketEndpoint() {
    return bridgeAuthToken ? `${WS_ENDPOINT}?token=${encodeURIComponent(bridgeAuthToken)}` : WS_ENDPOINT;
}

function sanitizeToken(value) {
    return typeof value === 'string' ? value.trim().slice(0, 512) : '';
}

function setStatus(msg) {
    chrome.runtime.sendMessage({ type: 'status', v: 1, msg }).catch(() => { });
}

function clearTimers() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
    }
    reconnectScheduled = false;
}

function resetRecovery() {
    reconnectAttempt = 0;
}

function nextReconnectDelayMs() {
    const exp = Math.min(reconnectAttempt, 8);
    return Math.min(WS_RETRY_MAX_MS, WS_RETRY_BASE_MS * Math.pow(2, exp));
}

function scheduleReconnect() {
    if (!autoConnect || manualDisconnect) return;
    if (reconnectScheduled) return;

    const delay = nextReconnectDelayMs();
    reconnectAttempt += 1;
    const attempt = reconnectAttempt;
    reconnectScheduled = true;
    clearTimers();
    reconnectTimer = setTimeout(() => {
        reconnectScheduled = false;
        console.log(`[Extension] Reconnect attempt #${attempt} after ${delay}ms`);
        setStatus(`OFFLINE (${delay}ms)`);
        socket = null;
        setupWebSocket(true);
    }, delay);
}

function armHeartbeat() {
    clearTimeout(heartbeatTimeout);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        try {
            socket.send(JSON.stringify({ type: 'ping', v: 1 }));
            heartbeatTimeout = setTimeout(() => {
                console.error('[YTMamp] Heartbeat timeout: closing socket');
                socket.close();
            }, WS_HEARTBEAT_TIMEOUT_MS);
        } catch (err) {
            console.error('[YTMamp] Failed to send heartbeat:', err);
        }
    }, WS_HEARTBEAT_MS);
}

function loadBridgeStateFromStorage(callback) {
    chrome.storage.sync.get({ autoConnect: true, bridgeAuthToken: '' }, (data) => {
        bridgeAuthToken = sanitizeToken(data.bridgeAuthToken);
        autoConnect = data.autoConnect;
        if (callback) callback();
    });
}

// Load settings
loadBridgeStateFromStorage(() => {
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
        } else if (tabs.length === 0) {
            chrome.runtime.sendMessage({ type: 'status', v: 1, msg: 'Need YTM Tab' }).catch(() => { });
        }
    });
}

function setupWebSocket(isRetry = false) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    if (isConnecting) return;

    isConnecting = true;
    if (!isRetry) console.log('[Extension] Attempting connection...');
    if (isRetry) {
        console.log(`[Extension] Reconnect attempt #${reconnectAttempt}`);
    }

    clearTimers();
    setStatus('WAITING');
    isAuthenticated = false;

    chrome.storage.sync.get({ bridgeAuthToken: '' }, (data) => {
        bridgeAuthToken = sanitizeToken(data.bridgeAuthToken);
        socket = new WebSocket(getSocketEndpoint());

        socket.onopen = () => {
            isConnecting = false;
            console.log('[Extension] Connected to Electron app socket');
            setStatus('WAITING');
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message.type === 'auth-request') {
                    isConnected = false;
                    setStatus('AUTH_REQUIRED');
                    chrome.runtime.sendMessage({ type: 'status', v: 1, msg: 'AUTH_REQUIRED' }).catch(() => { });
                    if (!manualDisconnect && autoConnect) {
                        socket.close();
                    }
                    return;
                }

                if (message.type === 'auth-ok') {
                    isAuthenticated = true;
                    isConnected = true;
                    resetRecovery();
                    console.log('[Extension] Bridge auth succeeded');
                    setStatus('CONNECTED');
                    armHeartbeat();
                    // Immediately check tab after connection
                    setTimeout(checkTabStatus, 500);
                    return;
                }

                if (message.type === 'auth-error') {
                    isAuthenticated = false;
                    isConnected = false;
                    const reason = message.reason || 'unauthorized';
                    console.error('[Extension] Bridge auth error:', reason);
                    setStatus(`AUTH_FAIL(${reason})`);
                    chrome.runtime.sendMessage({ type: 'status', v: 1, msg: reason }).catch(() => { });
                    socket.close();
                    return;
                }

                if (!isAuthenticated) {
                    isAuthenticated = true;
                    isConnected = true;
                    resetRecovery();
                    console.log('[Extension] Bridge connected without auth');
                    setStatus('CONNECTED');
                    armHeartbeat();
                }

                // Handle app status updates (visibility, etc)
                if (message.type === 'app') {
                    lastAppStatus.windowVisible = message.windowVisible;
                    chrome.runtime.sendMessage({ type: 'app', v: 1, windowVisible: message.windowVisible }).catch(() => { });
                    return;
                }

                if (message.type === 'pong') {
                    clearTimeout(heartbeatTimeout);
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
            isAuthenticated = false;
            isConnected = false;
            isConnecting = false;
            socket = null;
            clearTimers();
            setStatus('OFFLINE');

            if (autoConnect) {
                scheduleReconnect();
            }
        };

        socket.onerror = (err) => {
            isConnecting = false;
            console.error('[YTMamp] Socket error:', err && err.message ? err.message : err);
            if (autoConnect && !manualDisconnect) {
                scheduleReconnect();
            }
        };
    });
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

chrome.tabs.onRemoved.addListener(() => {
    checkTabStatus();
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
        if (!autoConnect) {
            manualDisconnect = true;
            if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                socket.close();
            }
            clearTimers();
        } else {
            manualDisconnect = false;
        }
        if (autoConnect) setupWebSocket();
        return;
    }

    // Manual connect
    if (message.type === 'manual_connect') {
        autoConnect = true;
        manualDisconnect = false;
        resetRecovery();
        chrome.storage.sync.set({ autoConnect: true });
        setupWebSocket();
        return;
    }

    // Manual disconnect
    if (message.type === 'manual_disconnect') {
        autoConnect = false;
        manualDisconnect = true;
        clearTimers();
        chrome.storage.sync.set({ autoConnect: false });
        if (socket) socket.close();
        return;
    }

    if (message.type === 'set_bridge_token') {
        bridgeAuthToken = sanitizeToken(message.token);
        chrome.storage.sync.set({ bridgeAuthToken }, () => {
            if (autoConnect) {
                manualDisconnect = false;
                resetRecovery();
                setupWebSocket();
            }
        });
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
