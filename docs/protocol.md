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

The v0.2.0 bridge is still localhost-only and validates payload shape, but it does not yet require pairing.

For v0.3.0, add a shared secret/token handshake:

- Generate a per-install token in the Electron app.
- Expose pairing/reset UX in the extension popup.
- Require the token during WebSocket connection setup.
- Reject unauthenticated local clients before accepting control commands.
