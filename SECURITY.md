# Security policy

Only the latest YTMamp release receives security updates.

## Network model

The desktop-extension WebSocket bridge listens on `127.0.0.1:18765` and requires a per-install pairing token by default. The HTTP integration API listens on `127.0.0.1:18880` by default.

LAN access is opt-in. A non-loopback `INTEGRATION_HOST` requires `INTEGRATION_TOKEN`, and browser-based cast clients require an explicit `CAST_ORIGIN_ALLOWLIST`. Optional Last.fm integration sends playback metadata to Last.fm only when configured.

## Report a vulnerability

Please use GitHub's **Report a vulnerability** form in the repository Security tab. If private reporting is unavailable, contact the maintainer without publishing exploit details in a public issue.
