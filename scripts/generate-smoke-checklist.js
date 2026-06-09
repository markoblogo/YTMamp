#!/usr/bin/env node
const fs = require('fs');

const out = `# YTMamp CI smoke checklist (v0.3.2)

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
- [ ] Verify app remains connected state-safe when YTM tab closes (`Need YTM Tab`).

## Browser + playback checks (manual)

- [ ] Chrome: extension connects and controls work for play/pause/next/prev/seek/volume/like/repeat/shuffle.
- [ ] Comet: extension connects and controls work.
- [ ] Atlas: extension connects and controls work.

## Completion status

- [ ] All above are complete for current release candidate.
`;

fs.writeFileSync('ci-smoke-checklist.md', out);
console.log('Wrote ci-smoke-checklist.md');
