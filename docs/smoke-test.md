# Release smoke test

Use this checklist before promoting a release beyond GitHub assets.

## v0.2.0 asset check

GitHub Release: https://github.com/markoblogo/YTMamp/releases/tag/v0.2.0

Published assets:

- `YTMamp-0.2.0-mac.dmg`
  - Size: `90011582`
  - SHA256: `69f1e7112592cf9c174992cc858e4017562731dc3c31f2698ad94967a9943af5`
- `YTMamp-0.2.0-mac.zip`
  - Size: `86325485`
  - SHA256: `76c55676a4bcf43e8a514967baf7582672818ff8710f87cef0a14b95aaceb0f6`

## Manual macOS smoke

1. Download the `.dmg` from the release.
2. Open the DMG and drag YTMamp to `Applications`.
3. Launch YTMamp from `Applications`.
4. Load the `extension/` directory as an unpacked extension in a Chromium browser.
5. Open `https://music.youtube.com`.
6. Click once inside the YouTube Music tab to allow audio capture.
7. Verify the app/extension status changes to connected.
8. Verify playback commands: play/pause, previous, next, seek, volume, like, shuffle, repeat.
9. Verify waveform renders or shows fallback when the browser blocks capture.
10. Close the YouTube Music tab and verify the app shows no connected YTM tab.
11. Move the app window, quit, relaunch, and verify window position restores.

## Known smoke constraints

- The extension is still installed manually as unpacked.
- The app is unsigned/not notarized unless a release signing pipeline is added.
- Waveform capture still depends on browser media-capture rules and a user gesture in the YTM tab.
