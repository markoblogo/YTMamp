# YTMamp

[![CI](https://github.com/markoblogo/YTMamp/actions/workflows/ci.yml/badge.svg)](https://github.com/markoblogo/YTMamp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/markoblogo/YTMamp?display_name=tag&sort=semver)](https://github.com/markoblogo/YTMamp/releases/latest)
[![License](https://img.shields.io/github/license/markoblogo/YTMamp)](LICENSE)

A compact retro desktop music player. It starts as a local folder player; switch to YouTube Music to control your signed-in browser tab through the Chromium companion.

Local playback is being introduced in a staged development branch. The published v0.4.1 downloads remain the YouTube Music remote described in their release notes.

[![YTMamp demo video](https://img.youtube.com/vi/fHRDm8e2n-U/maxresdefault.jpg)](https://youtu.be/fHRDm8e2n-U)

> [!NOTE]
> YTMamp is an independent open-source project and is not affiliated with Google or YouTube.

## What it does

- Add several music folders and their subfolders without copying audio. **ADD** opens the folder picker; **LIBRARY** shows tracks, albums and search. Local playback works without a browser or internet connection.
- Select **RADIO** in the same source switch. The directory loads automatically; **LIBRARY** opens station cards, name/genre/language search, sorting, favorites and custom streams. Duplicate stream variants are combined, direct MP3/AAC/OGG streams are preferred, and HLS-only entries are omitted because this preview cannot play them. A failed address is excluded for five minutes; playback tries another cached compatible address for the same station, and **Retry stream** clears that cooldown.
- In RADIO the progress strip becomes a retro FM dial. Prev/Next perform a short SEEK sweep with optional static, then tune the next/previous local frequency. Manual tuning remains available. macOS asks for the device location using Core Location; no city, country or region entry is required. Location is only for the local FM dial. Online stations work without it. Supplied frequency/coordinate data remains incomplete and is not a reception map.
- Selecting **YT MUSIC** opens YouTube Music in the default browser if no connected session is known. Repeated switches have a 30-second cooldown; a connected session is not reopened. **OPEN** retries opening. The browser companion must still be installed and paired in that browser profile; opening the site alone does not pair it. Without a connected companion, the app cannot inspect arbitrary browser tabs and may open an additional tab.
- **REC**, **II** and **STOP** record radio independently of playback. STOP opens the native Save As dialog for stereo 48 kHz/16-bit WAV. Cancel keeps the recording available for Save As or Discard. Pausing a recording excludes that interval while the station keeps playing.
- Collapse the library with **COLLAPSE** or the **LIBRARY** toggle; reopening keeps its search and album selection without interrupting playback.
- Choose **Player size** from a right click, the tray menu or **View**: 75%, 100%, 125% or 150%. The size is saved; 75% gives a 270 × 87 mini-player. Cmd/Ctrl `-`, `=` and `0` also change/reset size.
- Use **_** to hide the player and keep music playing. Restore it from the menu-bar/tray icon or the Dock. **X** quits the app and stops playback. Explicit hiding also suppresses YouTube auto-show until you bring the player back.
- Read embedded titles, artists, albums, track/disc numbers, genres and cover art. Search ignores letter case and accents, and can be limited to one folder. **Play album** follows disc/track order within that album.
- Restore the library and selected track paused. MP3, WAV, FLAC, M4A, AAC, OGG and OPUS files are recognized; decoder support depends on Electron. Missing tags fall back to filenames and folder names.
- Play, pause, skip, seek, change volume, like, shuffle, and repeat.
- Show track metadata and a live oscilloscope in a 360 × 116 always-on-top window.
- Integrate with system tray controls, media keys, startup settings, Last.fm, OBS, and a versioned local API.
- Run on macOS, Windows, and Linux with a Manifest V3 companion for Chromium browsers.

## Download

Download the latest files from [GitHub Releases](https://github.com/markoblogo/YTMamp/releases/latest):

| Platform | File |
| --- | --- |
| macOS | `YTMamp-*-mac.dmg` or `.zip` |
| Windows | `YTMamp-*-win.exe` or `.zip` |
| Linux | `YTMamp-*-linux.AppImage` or `.deb` |
| Chromium extension | `YTMamp-*-extension.zip` (v0.4.0+) |

Published release builds are currently unsigned and not notarized. Development Mac previews use ad-hoc signatures with archive verification; they are not Apple-notarized. Your operating system may ask you to confirm the first launch.

## Set up in five steps

1. Install and launch the desktop app. In the development preview, choose **ADD** and select your music folders for local listening. It remains available from the menu bar or system tray.
2. For YouTube Music, extract the extension ZIP. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.
3. In the YTMamp tray menu choose **Copy bridge token**. Paste it into the extension popup and select **Save** and **Connect**.
4. Open [YouTube Music](https://music.youtube.com) and click once in the page so the browser can start audio capture for the waveform.
5. Pin the extension for quick access. Install it separately in every browser profile you use.

Tested browser families and known limitations are listed in [browser support](docs/browser-support.md).

## Platform notes

- **macOS:** open the DMG and drag YTMamp to Applications. Launch it from Applications, not the mounted image.
- **Windows:** use the installer or extract the portable ZIP.
- **Linux:** install the DEB, or mark the AppImage executable with `chmod +x`. Tray support depends on the desktop environment.

If the extension reports a missing receiver after an update, refresh the YouTube Music tab. If the waveform is empty, click once inside that tab. If pairing fails, confirm the desktop app is running and copy the current token again.

## Privacy and network access

The desktop bridge and HTTP API listen on the local machine by default. The extension runs only on `music.youtube.com` and stores its bridge token in the browser profile. Last.fm is disabled unless credentials are configured.

Radio contacts the public Radio Browser directory for searches and a click counter on explicit station playback; audio and logos come from station servers, which see your IP address. Selecting RADIO requests device location for the local FM dial. On macOS a small bundled Core Location helper requests OS permission and asks Apple's geocoder for the city/country; no Google API key, IP geolocation or background tracking is used. The app receives rounded coordinates and saves them locally. If permission is denied or services are unavailable, the online catalog remains usable and the interface explains how to retry. Local FM is a 60 km proximity list of supplied coordinates/frequencies, not a real reception map. It may be empty or incomplete.

WAV recording uses about 11 MiB per minute, streams to a private temporary file and never buffers a whole recording in RAM. A session stops at 512 MiB or when less than 256 MiB is free; Save As can target an external drive. Canceled saves retain the temporary recording until it is saved or discarded. Switching away from RADIO stops recording and prompts to save. Quitting also prompts if a recording is unsaved. After an interrupted session the pending WAV is recovered in RADIO / LIBRARY. This preview has no MP3 encoder.

LAN integrations are opt-in. Setting `INTEGRATION_HOST` to a non-loopback address requires `INTEGRATION_TOKEN`; browser controllers also require an explicit `CAST_ORIGIN_ALLOWLIST`. See the [integration API](docs/integration-api.md) and [bridge protocol](docs/protocol.md).

## Develop

Requires Node.js 22.12 or newer; CI uses Node.js 24.

```bash
git clone https://github.com/markoblogo/YTMamp.git
cd YTMamp/app
npm ci
npm run check
npm audit --audit-level=high
npm run pack
```

`npm start` launches the desktop app. Platform installers are built with `npm run dist:mac`, `npm run dist:win`, or `npm run dist:linux`.

CI checks lint, tests, dependency audit, and an unpacked app package on macOS, Windows, and Ubuntu. Interactive desktop/browser checks remain separate in the [release smoke plan](docs/smoke-test.md).

`npm run test:desktop` runs an isolated, muted Electron playback smoke with generated audio. The [multi-source implementation plan](docs/roadmap/multi-source-player.md) defines stage boundaries and candidate donor projects. Whole-computer music discovery is excluded; only explicitly selected music folders are used.

`npm run test:library:desktop` exercises folder addition, real tags and image decoding, album queues, search and external-drive recovery. The library supports up to 20 selected roots and 10,000 unique tracks, with an additional 5,000-track/50,000-entry scan limit per root. Its metadata manifest is capped at 16 MiB and artwork cache at 32 MiB (2 MiB per picture). These limits protect small disks; original audio stays in place. **Refresh** picks up changed music and reconnected drives. Removing a folder from the library keeps its files intact. Tag editing is not included.

## Integrations

- [Local HTTP API](docs/integration-api.md): status, current track, event stream, OBS overlay, and remote controls.
- [Local WebSocket protocol](docs/protocol.md): authenticated desktop-to-extension bridge.
- [Pocket-OS Cardputer](https://github.com/markoblogo/Pocket-OS-Cardputer-ABV): device-side remote client and validation.
- Last.fm scrobbling: opt-in environment configuration documented in the integration API.

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md). YTMamp is available under the [MIT License](LICENSE).

<!-- ABVX:ECOSYSTEM:BEGIN -->
## ABVX ecosystem

- [AGENTS.md_generator](https://agentsmd.abvx.xyz/) — Keeps repository guidance and machine-readable context current. Current release: `v0.5.1`.
- [abvx-agent-skills](https://abvx.xyz/work/abvx-agent-skills) — Uses shared, reviewable agent capabilities during maintenance. Current release: `v0.16.1`.

_This block is generated from the reviewed ABVX ecosystem registry._
<!-- ABVX:ECOSYSTEM:END -->
