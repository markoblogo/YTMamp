#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let version = '0.0.0';
try {
    const appPackagePath = path.join(__dirname, '../app/package.json');
    version = JSON.parse(fs.readFileSync(appPackagePath, 'utf8')).version || version;
} catch (_e) {
    // keep fallback in non-standard environments
}

const out = `# YTMamp CI smoke checklist (v${version})

Generated at: ${new Date().toISOString()}
Source: GitHub Actions matrix run

## Platform checks

- [ ] macOS: tray icon appears and menu actions work (show/hide/start at login/auto-show/quit).
- [ ] macOS: autostart toggle can be set and persists after relaunch.
- [ ] macOS: window position persists after move + relaunch.

- [ ] Windows: tray icon appears and menu actions work (show/hide/start at login/auto-show/quit).
- [ ] Windows: autostart toggle can be set and persists after relaunch.
- [ ] Windows: window position persists after move + relaunch.

- [ ] Linux: tray icon appears where AppIndicator/tray is available.
- [ ] Linux: autostart entry is created at ~/.config/autostart/ytmamp.desktop when enabled.
- [ ] Linux: autostart entry is removed when disabled.
- [ ] Linux: app start does not fail when autostart is enabled/disabled rapidly.

## Edge-case checks (detached/edge paths)

- [ ] Toggle Start at login while the window is hidden/minimized.
- [ ] Close/reopen app repeatedly (3x) while tray is used for show/hide.
- [ ] Toggle "Auto-show on play" while no active YouTube Music tab is connected.
- [ ] Verify app remains connected state-safe when YTM tab closes ('Need YTM Tab').

## Local Integration API checks

- [ ] /status contract: 200 with canonical payload includes x-ytmamp-api-version, content-type: application/json; charset=utf-8, cache-control: no-store.
- [ ] /current-track contract: 204 when empty, 200 with canonical payload when track exists.
- [ ] /status and /current-track reject unsupported API versions with HTTP 400 and version error body.
- [ ] /status and /current-track enforce local+token gates (401, 403) and return x-ytmamp-api-version.
- [ ] /events and /obs return expected headers for negative and success paths (including CORS allowlist for OBS).

## Browser + playback checks (manual)

- [ ] Chrome: extension connects and controls work for play/pause/next/prev/seek/volume/like/repeat/shuffle.
- [ ] Comet: extension connects and controls work.
- [ ] Atlas: extension connects and controls work.

## Completion status

- [ ] All above are complete for current release candidate.
`;

fs.writeFileSync('ci-smoke-checklist.md', out);
console.log('Wrote ci-smoke-checklist.md');
