# YTMamp local bridge protocol

YTMamp uses a local WebSocket bridge between the Electron app and the browser extension.

- Endpoint: `ws://127.0.0.1:18765`
- Message version: `v: 1`
- All messages are JSON objects.

## Commands

Renderer-to-extension commands:

- `playPause`
- `next`
- `prev`
- `seek` with `valueSec`
- `setVolume` with `value` from `0` to `1`
- `like`
- `dislike`
- `shuffle`
- `repeat`

Popup-to-app commands:

- `showWindow`
- `hideWindow`

## Status

The extension sends status updates to the app:

- `Client connected`
- `Need YTM Tab`
- `OFFLINE`
- `WAITING`

When the app receives `Need YTM Tab`, the renderer clears stale track state and shows a disconnected tab message.

## Validation

The app validates message version, known message types, known commands, numeric ranges, and waveform payload sizes before forwarding data to the renderer or extension.

Track metadata is normalized before renderer IPC:

- `title`: string, trimmed, max 300 characters
- `artist`: string, trimmed, max 300 characters

## Security TODO

The v0.3.x bridge now supports optional token pairing and local-trust mode.

### Token pairing (prod)

- The desktop app generates/stores a per-install token in `settings.json` as `bridgeAuthToken`.
- The app accepts either:
  - a matching query token (`ws://127.0.0.1:18765?token=...`) during connect, or
  - an `auth` websocket message (`{ type: "auth", token: "..." }`) immediately after connect.
- If a connection is attempted without token, app responds with `auth-request` and then closes with code `4003`.
- Valid token: app sends `auth-ok`, then accepts control commands.
- Invalid token: app sends `auth-error` with reason and closes socket.

### Local trust mode

Set `LOCAL_TRUST=true` in Electron runtime env to keep unauthenticated local development behavior.

### Runtime messages

Additional auth-related messages:

- `auth-request` — token required to proceed.
- `auth-ok` — token accepted and active session started.
- `auth-error` — token missing/invalid/timeouts.
