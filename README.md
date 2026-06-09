# YTMamp
[![Release](https://img.shields.io/github/v/release/markoblogo/YTMamp?display_name=tag&sort=semver)](https://github.com/markoblogo/YTMamp/releases/latest)
[![Build](https://github.com/markoblogo/YTMamp/actions/workflows/release.yml/badge.svg)](https://github.com/markoblogo/YTMamp/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/markoblogo/YTMamp)](LICENSE)

**License:** MIT. See [LICENSE](LICENSE).

**YTMamp** is a lightweight, retro-inspired mini-player for YouTube Music on desktop. It pairs a high-performance Electron application with a specialized Chromium browser extension to give you seamless control over your music without ever leaving your workflow.

## Demo
[![YTMamp demo video](https://img.youtube.com/vi/fHRDm8e2n-U/maxresdefault.jpg)](https://youtu.be/fHRDm8e2n-U)

### Download
Get the latest desktop build from [GitHub Releases](https://github.com/markoblogo/YTMamp/releases/latest):
- macOS: `YTMamp-*-mac.dmg`
- Windows: `YTMamp-*-win.exe` or `YTMamp-*-win.zip`
- Linux: `YTMamp-*-linux.AppImage` or `YTMamp-*-linux.deb`

Package status:
- macOS/Windows/Linux smoke checks are completed for v0.3.2.
- v0.3.3 hardening tasks are in-progress (`deterministic reconnect`, `tray/autostart proof`, and PR smoke summary automation).

### Verified matrix

- OS: macOS 14.x, Windows 11, Ubuntu 24.04
- Browsers: Chrome, Comet, Atlas

> [!NOTE]
> YTMamp is an independent open-source project and is not affiliated with Google or YouTube.

---

## Features
- **Retro Aesthetic**: Modern take on classic player designs with neon green accents.
- **Always on Top**: Keeps your controls accessible while you work.
- **Waveform Visualizer**: Real-time oscilloscope driven by your music.
- **Expanded Controls**: Play/pause, previous, next, seek, volume, like, shuffle, and repeat.
- **Native Experience**: System tray integration, "Start at login" support, and global media keys.
- **Auto-pilot**: Automatically hides the native YTM mini-player and can auto-show itself on playback.

---

## 🛠 Installation

### macOS
1. **Download the latest DMG** from the [GitHub Releases](https://github.com/markoblogo/YTMamp/releases).
2. **Install**: Open the `.dmg` and drag **YTMamp** to your `Applications` folder.
> [!IMPORTANT]
> The DMG is an installer. Once installed, launch YTMamp from your **Applications** folder, not from the mounted disk image.
3. **Launch**: Open YTMamp. You'll see a green icon in your menu bar.

### Windows
1. Download `YTMamp-*-win.exe` from [GitHub Releases](https://github.com/markoblogo/YTMamp/releases).
2. Run the installer and launch **YTMamp** from the Start menu.
3. You should see the YTMamp icon in the system tray.

Portable option: download `YTMamp-*-win.zip`, extract it, and run the app from the extracted folder.

### Linux
1. Download either `YTMamp-*-linux.AppImage` or `YTMamp-*-linux.deb` from [GitHub Releases](https://github.com/markoblogo/YTMamp/releases).
2. For AppImage: make it executable, then run it.
   ```bash
   chmod +x YTMamp-*-linux.AppImage
   ./YTMamp-*-linux.AppImage
   ```
3. For Debian/Ubuntu:
   ```bash
   sudo apt install ./YTMamp-*-linux.deb
   ```

Linux tray visibility depends on the desktop environment and AppIndicator/system tray support.

### 🧩 Browser Extension Setup
Currently, the extension is installed in "Unpacked" mode:
1. Open a supported Chromium browser. Tested: **Chrome**, **Comet**, **Atlas**.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the `extension/` folder from this directory.
5. **Pin it**: Click the puzzle icon in your toolbar and pin YTMamp for quick access.

Extensions are installed per browser/profile. If you use Comet, Atlas, and Chrome, install it in each browser/profile as needed.

Browser support notes: [docs/browser-support.md](docs/browser-support.md).
---

## 🚀 Getting Started Checklist
1. Open [YouTube Music](https://music.youtube.com).
2. Click **anywhere** on the page once (required by browsers to allow audio capturing for the waveform).
3. Ensure the status indicator in YTMamp (or the extension popup) shows **Connected**.
4. Play some music and enjoy!

---

## 🔍 Troubleshooting
- **"Receiving end does not exist"**: If you just updated the extension, refresh your YouTube Music tab.
- **No Waveform**: Make sure you've clicked inside the YTM tab at least once since opening it.
- **Not Connecting**: Ensure the YTMamp desktop app is running and check the tray/menu bar icon.

---

## 🛠 For Developers

### Local Setup
```bash
# Setup the desktop app
cd app
npm install
npm run check
npm start

# For platform builds
npm run dist:mac
npm run dist:win
npm run dist:linux
```

### Protocol
The local app/extension bridge is documented in [docs/protocol.md](docs/protocol.md).

### Browser support
Tested Chromium browsers are documented in [docs/browser-support.md](docs/browser-support.md).

### Release QA
Release smoke testing is tracked in [docs/smoke-test.md](docs/smoke-test.md).

### Cross-platform notes
Windows/Linux packaging and tray/autostart checks are tracked in [docs/cross-platform.md](docs/cross-platform.md).

### Build Releases Locally
To generate platform release artifacts on your own machine:
```bash
cd app
npm run dist:mac    # macOS DMG + ZIP
npm run dist:win    # Windows NSIS installer + ZIP
npm run dist:linux  # Linux AppImage + DEB
```
Find your builds in `app/dist/`.

Release builds are produced by GitHub Actions on matching runners: macOS, Windows, and Ubuntu.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.
