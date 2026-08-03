# Release smoke test

Use this checklist before promoting a release beyond GitHub assets.

## v0.3.2 asset check

GitHub Release: https://github.com/markoblogo/YTMamp/releases/tag/v0.3.2

Status: **Passed manual smoke on macOS, Windows 11, and Ubuntu 24.04**.

Date: 2026-06-09.

Published assets:

- `YTMamp-0.3.2-mac.dmg`
- `YTMamp-0.3.2-mac.zip`
- `YTMamp-0.3.2-win.exe`
- `YTMamp-0.3.2-win.zip`
- `YTMamp-0.3.2-linux.AppImage`
- `YTMamp-0.3.2-linux.deb`

## Manual smoke matrix for v0.3.2

### Desktop
1. Install/run the platform-specific package.
2. Verify tray icon appears and menu actions (Show/Hide, Start at login, Auto-show on play, Quit) work.
3. Enable/disable Start at login and confirm persistence after restart.
4. Move app window, quit, relaunch, and confirm window position restores.
5. Verify app handles rapid launch/close cycles with tray commands.

### Browser + playback
1. Load the unpacked extension in a tested Chromium browser.
2. Open `https://music.youtube.com`.
3. Click once inside the page.
4. Verify status `Connected`.
5. Verify controls: play/pause, previous, next, seek, volume, like, shuffle, repeat.
6. Verify waveform renders or fallback appears when capture is blocked.
7. Close the YTM tab and confirm app shows disconnected state.
8. Verify `Need YTM Tab` state is shown instead of stale track info.

### Detached tray/autostart edge cases
1. Toggle Start at login while window is hidden/minimized.
2. Confirm no crash or stale tray menu state.
3. Toggle Start at login repeatedly (3x) and confirm persistence.
4. Confirm Linux autostart entry is added/removed under `~/.config/autostart/ytmamp.desktop`.

## CI smoke checklist

- CI generates `ci-smoke-checklist.md` for each OS matrix job.
- Artifact: `smoke-check-<os>-<sha>` is uploaded to workflow run.
- Generated list contains detached tray/autostart edge-case scenarios required for manual QA.
- A dedicated integration-API block tracks `/status`, `/current-track`, `/events`, and `/obs` contract checks (status matrix + auth/headers/rate-limit behavior).

## Known smoke constraints

- The extension is still installed manually as unpacked.
- App artifacts are unsigned/not notarized (unless signing pipeline is added).
- Waveform capture still depends on browser media capture and user gesture in the YTM tab.
- Linux tray behavior depends on desktop environment/AppIndicator support.

## Previous version checks

- `v0.2.0` macOS manual smoke was previously verified and remained supported during v0.3.x.

## v0.3.3 hardening manual check (in-progress)

Date: 2026-06-09
Verifier: local QA / manual report

- ✅ Windows 11: detached tray + start-at-login toggling + window restore verified.
- ✅ Ubuntu 24.04: detached tray/autostart edge-case checks completed.
- ✅ Reconnect/resilience checks: repeated app close/open with active YTM tab and manual reconnect path passed.

> Note: this section is prepared for follow-up CI/QA sign-off and will be finalized with full signer notes on PR merge.
