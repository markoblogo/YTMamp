const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onStatusChange: (callback) => ipcRenderer.on('status-change', (event, value) => callback(value)),
    onTrackUpdate: (callback) => ipcRenderer.on('track-update', (event, value) => callback(value)),
    onPluginStatus: (callback) => ipcRenderer.on('plugin-status', (event, value) => callback(value)),
    onWaveUpdate: (callback) => ipcRenderer.on('wave-update', (event, value) => callback(value)),
    onVolStatus: (callback) => ipcRenderer.on('vol-status', (event, value) => callback(value)),
    onStateUpdate: (callback) => ipcRenderer.on('state-update', (event, value) => callback(value)),
    sendCommand: (command) => ipcRenderer.send('send-command', command),
    quitApp: () => ipcRenderer.send('quit-app'),
    hideWindow: () => ipcRenderer.send('hide-window')
});
