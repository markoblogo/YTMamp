# YTMamp agent guide

YTMamp combines an Electron desktop mini-player with a Manifest V3 Chromium extension for YouTube Music.

## Start here

Read `README.md`, `docs/protocol.md`, `docs/integration-api.md`, and `app/package.json`. Keep app, extension, protocol, and installation docs consistent.

## Security invariants

- Bind HTTP and WebSocket services to loopback by default.
- Require `INTEGRATION_TOKEN` whenever `INTEGRATION_HOST` exposes the HTTP API beyond loopback.
- Never reflect arbitrary browser origins. Use the explicit OBS and cast origin allowlists.
- Keep bridge authentication enabled in production; `LOCAL_TRUST=true` is development-only.
- Keep Electron renderer isolation, sandboxing, navigation blocking, and CSP intact.

## Verification

From `app/`, run:

```bash
npm ci
npm run check
npm audit --audit-level=high
npm run pack
```

Do not treat a package build as an interactive desktop or browser smoke test. Record those separately in `docs/smoke-test.md`.

## Release consistency

Before tagging, keep these versions equal:

- `app/package.json`
- `app/package-lock.json`
- `extension/manifest.json`

A tag starts release builds for macOS, Windows, Linux, and the extension ZIP. Confirm the workflow and public release assets before calling a release complete.
