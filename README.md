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

- Play local music from a selected folder and its subfolders without copying audio. Use **FOLDER**, **LIST** and the **LOCAL / YT MUSIC** selector; local playback works without a browser or internet connection.
- Restore the last local folder and selected track paused. MP3, WAV, FLAC, M4A, AAC, OGG and OPUS files are recognized; decoder support depends on Electron. Current labels come from filenames; embedded tags and covers follow in the next stage.
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

Release builds are currently unsigned and not notarized. Your operating system may ask you to confirm the first launch.

## Set up in five steps

1. Install and launch the desktop app. It remains available from the menu bar or system tray.
2. Extract the extension ZIP. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.
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
