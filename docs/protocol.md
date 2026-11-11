# YTMamp local bridge protocol

YTMamp uses an authenticated WebSocket bridge between the Electron app and its Chromium extension.

- Endpoint: `ws://127.0.0.1:18765`
- Message version: `v: 1`
- Format: JSON objects

## Pair the extension

1. Launch YTMamp.
2. Open its menu bar or tray menu and choose **Copy bridge token**.
3. Paste the token into the extension popup, then select **Save** and **Connect**.

The desktop app generates and stores a random per-install token. The extension supplies it as the `token` query parameter when connecting. A client may instead send `{ "type": "auth", "token": "..." }` immediately after connecting.

A missing token produces `auth-request` followed by WebSocket close code `4003`. A valid token produces `auth-ok`; an invalid or expired attempt produces `auth-error` and closes the socket. `LOCAL_TRUST=true` permits unauthenticated loopback development and must not be used for production builds.

## Commands

Renderer-to-extension commands are `playPause`, `next`, `prev`, `seek` (`valueSec`), `setVolume` (`value` from `0` to `1`), `like`, `dislike`, `shuffle`, and `repeat`.

The local-player development branch also accepts `pause`, an idempotent media pause used when switching away from YouTube Music. Update the companion extension together with the desktop branch. LOCAL commands are handled inside the app and are not relayed to the extension. Protocol message version stays `1`; published v0.4.1 companions do not implement this new command.

Popup-to-app commands are `showWindow` and `hideWindow`.

## Status and validation

The extension reports `Client connected`, `Need YTM Tab`, `OFFLINE`, or `WAITING`. When no YouTube Music tab is connected, the renderer clears stale track state.

The app validates protocol version, message types, commands, numeric ranges, and waveform payload size. Track titles and artists are trimmed and limited to 300 characters before renderer IPC.

The 0.7.0 development preview also has RADIO. Radio commands are handled in the desktop app, never forwarded to the YouTube companion. Play/pause starts/stops the selected online stream, Prev/Next select only the local FM queue, and Like toggles a station favorite. Seek/shuffle/repeat have no radio operation. Recording and location use sender-checked desktop IPC and are not exposed by the browser bridge.
