# Release smoke test

Use this checklist before promoting a release beyond GitHub assets.

## v0.3.1 asset check

GitHub Release: https://github.com/markoblogo/YTMamp/releases/tag/v0.3.1

Status: **Passed manual smoke on macOS, Windows 11, and Ubuntu 24.04**.

Date: 2026-06-09.

Published assets:

- `YTMamp-0.3.1-mac.dmg`
- `YTMamp-0.3.1-mac.zip`
- `YTMamp-0.3.1-win.exe`
- `YTMamp-0.3.1-win.zip`
- `YTMamp-0.3.1-linux.AppImage`
- `YTMamp-0.3.1-linux.deb`

## Manual smoke matrix for v0.3.1

### Desktop
1. Install/run the platform-specific package.
2. Verify tray icon appears and menu actions (Show/Hide, Start at login, Auto-show on play, Quit) work.
3. Enable/disable Start at login and confirm persistence after restart.
4. Move app window, quit, relaunch, and confirm window position restores.

### Browser + playback
1. Load the unpacked extension in a tested Chromium browser.
2. Open `https://music.youtube.com`.
3. Click once inside the page.
4. Verify status `Connected`.
5. Verify controls: play/pause, previous, next, seek, volume, like, shuffle, repeat.
6. Verify waveform renders or fallback appears when capture is blocked.
7. Close the YTM tab and confirm app shows disconnected state.

## Known smoke constraints

- The extension is still installed manually as unpacked.
- App artifacts are unsigned/not notarized (unless signing pipeline is added).
- Waveform capture still depends on browser media capture and user gesture in the YTM tab.
- Linux tray behavior depends on desktop environment/AppIndicator support.

## Previous version checks
- `v0.2.0` macOS manual smoke was previously verified and remained supported during v0.3.x.
