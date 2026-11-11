const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onStatusChange: (callback) => ipcRenderer.on('status-change', (event, value) => callback(value)),
    onTrackUpdate: (callback) => ipcRenderer.on('track-update', (event, value) => callback(value)),
    onPluginStatus: (callback) => ipcRenderer.on('plugin-status', (event, value) => callback(value)),
    onPluginUI: (callback) => ipcRenderer.on('plugin-ui', (event, value) => callback(value)),
    onWaveUpdate: (callback) => ipcRenderer.on('wave-update', (event, value) => callback(value)),
    onVolStatus: (callback) => ipcRenderer.on('vol-status', (event, value) => callback(value)),
    onStateUpdate: (callback) => ipcRenderer.on('state-update', (event, value) => callback(value)),
    sendCommand: (command) => ipcRenderer.send('send-command', command),
    onSourceChange: (callback) => ipcRenderer.on('source-change', (_event, value) => callback(value)),
    onLocalAudioCommand: (callback) => ipcRenderer.on('local-audio-command', (_event, value) => callback(value)),
    onLocalCatalog: (callback) => ipcRenderer.on('local-catalog', (_event, value) => callback(value)),
    onLocalSelection: (callback) => ipcRenderer.on('local-selection', (_event, value) => callback(value)),
    onFolderNotice: (callback) => ipcRenderer.on('folder-notice', (_event, value) => callback(value)),
    setSource: (source) => ipcRenderer.send('set-source', source),
    openMusicFolder: () => ipcRenderer.send('open-music-folder'),
    cancelFolderScan: () => ipcRenderer.send('cancel-folder-scan'),
    selectLocalTrack: (id) => ipcRenderer.send('select-local-track', id),
    reportLocalAudio: (report) => ipcRenderer.send('local-audio-report', report),
    setQueueVisible: (visible) => ipcRenderer.send('set-queue-visible', visible),
    quitApp: () => ipcRenderer.send('quit-app'),
    hideWindow: () => ipcRenderer.send('hide-window')
});
