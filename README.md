# YTMamp

[![CI](https://github.com/markoblogo/YTMamp/actions/workflows/ci.yml/badge.svg)](https://github.com/markoblogo/YTMamp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/markoblogo/YTMamp?display_name=tag&sort=semver)](https://github.com/markoblogo/YTMamp/releases/latest)
[![License](https://img.shields.io/github/license/markoblogo/YTMamp)](LICENSE)

A compact retro remote for YouTube Music. The desktop app stays above your work while a Chromium companion controls the active YouTube Music tab.

[![YTMamp demo video](https://img.youtube.com/vi/fHRDm8e2n-U/maxresdefault.jpg)](https://youtu.be/fHRDm8e2n-U)

> [!NOTE]
> YTMamp is an independent open-source project and is not affiliated with Google or YouTube.

## What it does

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

## Integrations

- [Local HTTP API](docs/integration-api.md): status, current track, event stream, OBS overlay, and remote controls.
- [Local WebSocket protocol](docs/protocol.md): authenticated desktop-to-extension bridge.
- [Pocket-OS Cardputer](https://github.com/markoblogo/Pocket-OS-Cardputer-ABV): device-side remote client and validation.
- Last.fm scrobbling: opt-in environment configuration documented in the integration API.

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md). YTMamp is available under the [MIT License](LICENSE).
