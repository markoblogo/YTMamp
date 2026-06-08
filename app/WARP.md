# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands

### Install dependencies

Use npm in the `app` directory:

- Install: `npm install`

### Run the app in development

- Start Electron in dev mode: `npm start`

This launches the Electron main process from `src/main/main.js` and loads the renderer UI from `src/renderer/index.html`.

### Build / package the app

- Clean build artifacts: `npm run clean`
- Build all distributables via electron-builder: `npm run dist`
- Build macOS distributables (DMG + ZIP): `npm run dist:mac`
- Build Windows distributables (NSIS + ZIP): `npm run dist:win`
- Build Linux distributables (AppImage + DEB): `npm run dist:linux`

Artifacts will be written to `dist/` using the configuration under the `build` key in `package.json`.

### Tests / linting

- Syntax check: `npm run lint`
- Unit/integration tests: `npm test`
- Combined local check: `npm run check`

## Architecture overview

### High-level structure

This is a small Electron app structured as:

- Electron **main process** code in `src/main/`
- Electron **renderer/UI** code in `src/renderer/`
- Build assets (icons, etc.) in `assets/`
- Packaged output in `dist/` (generated, usually not edited directly)

Electron is configured via `package.json`:

- `main`: `src/main/main.js`
- `scripts.start`: `electron .` (entry is `main` above)
- `build` (electron-builder): config for macOS, Windows, and Linux targets, output directories, and included files.

### Main process (`src/main`)

**`main.js`** is the central orchestrator for the desktop app:

- Manages the Electron app lifecycle (`app.whenReady`, `app.on('activate')`, `app.on('window-all-closed')`).
- Creates and configures a frameless, always-on-top `BrowserWindow` for the mini player UI.
- Loads the renderer HTML from `src/renderer/index.html` and injects the preload script from `src/main/preload.js`.
- Manages a system tray (`Tray`) with a context menu for:
  - Toggling the main window visibility
  - Toggling "Start at login" (autostart) and applying it via `app.setLoginItemSettings` on macOS/Windows or XDG autostart on Linux
  - Toggling "Auto-show on play" behavior
  - Quitting the app
- Implements **settings persistence**:
  - Stores user settings (currently `startAtLogin` and `autoShowOnPlay`) in `settings.json` under `app.getPath('userData')`.
  - On startup, loads and merges settings from disk, then applies autostart.
  - On changes, writes the updated settings file to disk and updates dependent behavior (e.g., tray menu, autostart).
- Manages window visibility state and broadcasts it to connected WebSocket clients.

**IPC and command bridge:**

- Uses `ipcMain` to listen for commands from the renderer (e.g., `send-command`, `quit-app`, `hide-window`).
- Relays commands received from the renderer over WebSocket to external clients.
- Relays events/messages from WebSocket clients to the renderer via `webContents.send` on channels such as `status-change`, `track-update`, `vol-status`, `state-update`, and `wave-update`.
- The WebSocket bridge lives in `src/main/ws_bridge.js` so protocol validation, command relay, cleanup, and tests do not require launching Electron.

### WebSocket server / external integration

`main.js` starts a local WebSocket server:

- Created via `new WebSocketServer({ host: '127.0.0.1', port: 18765 })`.
- On each client connection:
  - Logs the client IP and sends the current settings and window visibility.
  - Listens for JSON messages with a `type` and version `v` (currently `v: 1`).

Message types handled include (non-exhaustive, conceptual view):

- **Ping/pong**: `type: 'ping'` → responds with `type: 'pong'`.
- **Commands from external client**: `type: 'cmd'` with `cmd` values like `showWindow`, `hideWindow`.
- **Playback events**: `type: 'event', name: 'playingStarted'` which may auto-show the window if `autoShowOnPlay` is enabled.
- **Settings management**:
  - `type: 'set-setting'` with `key` / `value` updates persisted settings, broadcasts them to all clients, and refreshes the tray menu when relevant.
  - `type: 'get-settings'` triggers a one-time send of the current settings.
- **UI data updates** sent to the renderer via IPC:
  - `status` → `status-change`
  - `track` → `track-update`
  - `volStatus` → `vol-status`
  - `state` → `state-update`
  - `wave` / `waveFallback` → `wave-update`

One global IPC handler (`send-command`) forwards renderer-originating commands to the active WebSocket client. This avoids leaking per-connection IPC listeners when clients disconnect abnormally.

### Preload script (`src/main/preload.js`)

The preload script exposes a **narrow, versioned bridge API** to the renderer:

- Uses `contextBridge.exposeInMainWorld('electronAPI', { ... })`.
- Provides subscription-style helpers:
  - `onStatusChange`, `onTrackUpdate`, `onWaveUpdate`, `onVolStatus`, `onStateUpdate` — each wraps `ipcRenderer.on(...)` and forwards the payloads to callbacks.
- Provides command helpers:
  - `sendCommand(command)` → forwards to `ipcRenderer.send('send-command', command)`.
  - `quitApp()` → sends `quit-app`.
  - `hideWindow()` → sends `hide-window`.

All higher-level UI logic in the renderer goes through this `window.electronAPI` surface rather than using Electron APIs directly.

### Renderer/UI (`src/renderer`)

**`index.html`** defines the mini player UI:

- A narrow, fixed-size window with:
  - A top bar showing the app name, connection status LED, volume status, and a close button.
  - A middle section with a waveform canvas on the left and track info + progress bar on the right.
  - A bottom bar with playback controls (prev, play/pause, next) and a volume slider.
- Loads `styles.css` for a retro terminal-like theme and `renderer.js` for behavior.

**`renderer.js`** implements UI behavior and integrates with the preload API:

- Maintains local UI state:
  - Command counter for logging and tracing IPC/Ws commands.
  - Volume/UI state, including drag state and a short cooldown to prevent race conditions when syncing volume from external updates.
  - Seeking state for the progress bar, including throttling of `seek` commands.
- Provides `sendCommand(type, cmd, extra)` helper to wrap all outbound commands, logging them and routing via `window.electronAPI.sendCommand`.
- Handles inbound events via the preload API:
  - Status updates: update the LED element with classes `offline`, `connected`, or `waiting` and a tooltip.
  - Waveform updates: render live or fallback waveforms on the canvas with a simple animation.
  - Volume status: update a small `VOL: ...` text and color based on status (`ok`, `fallback`, error).
  - Track updates: set title/artist text, update volume slider when safe to do so, and log diagnostics.
  - Player state updates: update the timer text and progress bar position, including disabling the bar when duration is unknown.
- Wires DOM controls to commands:
  - Close button → `quitApp()`.
  - Prev / Play-Pause / Next → `sendCommand('cmd', ...)` with appropriate command names.
  - Progress slider → throttled `seek` commands, with pointer/mouse events managing `isSeeking`.
  - Volume slider → `setVolume` commands, honoring local drag and cooldown rules.
- Contains optional debug/diagnostic output that can be enabled via `DEBUG_OVERLAY` / `DEBUG_UI` flags.

**`styles.css`** defines the compact layout and app-region behavior:

- Fixed-height container matching the BrowserWindow size; the app is effectively a mini player bar.
- Uses `-webkit-app-region: drag` on the top bar and `no-drag` on interactive controls, matching Electron frameless window best practices.
- Provides styling for the status LED states, retro fonts, buttons, sliders, and optional debug overlays.

### Build and packaging

Electron-builder is configured directly in `package.json` under the `build` key:

- `appId`, `productName`, and macOS bundle category.
- `directories.output`: `dist/` and `directories.buildResources`: `assets/`.
- macOS targets: `dmg` and `zip`, with a custom `artifactName` pattern and installer window configuration.
- `files` array determines which paths are included in the packaged app (notably `src/**/*`, `renderer/**/*`, `assets/**/*`, and `package.json`).

When changing app structure, keep this `files` list in sync so the packaged app contains the necessary code and assets.
