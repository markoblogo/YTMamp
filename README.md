# YTMamp
[![Release](https://img.shields.io/github/v/release/markoblogo/YTMamp?display_name=tag&sort=semver)](https://github.com/markoblogo/YTMamp/releases/latest)
[![Build](https://github.com/markoblogo/YTMamp/actions/workflows/release.yml/badge.svg)](https://github.com/markoblogo/YTMamp/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/markoblogo/YTMamp)](LICENSE)

**YTMamp** is a lightweight, retro-inspired mini-player for YouTube Music on macOS. It pairs a high-performance Electron desktop application with a specialized browser extension to give you seamless control over your music without ever leaving your workflow.

## Demo
[![YTMamp demo video](https://img.youtube.com/vi/fHRDm8e2n-U/maxresdefault.jpg)](https://youtu.be/fHRDm8e2n-U)

### Download
Get the latest macOS installer from **Releases** (DMG).

> [!NOTE]
> YTMamp is an independent open-source project and is not affiliated with Google or YouTube.

---

## Features
- **Retro Aesthetic**: Modern take on classic player designs with neon green accents.
- **Always on Top**: Keeps your controls accessible while you work.
- **Waveform Visualizer**: Real-time oscilloscope driven by your music.
- **Native Experience**: System tray integration, "Start at login" support, and global media keys.
- **Auto-pilot**: Automatically hides the native YTM mini-player and can auto-show itself on playback.

---

## 🛠 Installation (Recommended)

1. **Download the latest DMG** from the [GitHub Releases](https://github.com/your-username/YTMamp/releases).
2. **Install**: Open the `.dmg` and drag **YTMamp** to your `Applications` folder.
> [!IMPORTANT]
> The DMG is an installer. Once installed, launch YTMamp from your **Applications** folder, not from the mounted disk image.
3. **Launch**: Open YTMamp. You'll see a green icon in your menu bar.

### 🧩 Browser Extension Setup
Currently, the extension is installed in "Unpacked" mode:
1. Open Chrome (or any Chromium browser like Brave/Edge/Atlas/Comet/etc.).
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the `extension/` folder from this directory.
5. **Pin it**: Click the puzzle icon in your toolbar and pin YTMamp for quick access.

Extensions are installed per browser/profile. If you use Comet and Chrome, install it in both if needed
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
- **Not Connecting**: Ensure the YTMamp desktop app is running (check your menu bar).

---

## 🛠 For Developers

### Local Setup
```bash
# Setup the desktop app
cd app
npm install
npm start

# For subsequent builds
npm run dist
```

### Build Releases Locally
To generate the `.dmg` and `.zip` artifacts on your own machine:
```bash
cd app
npm run clean
npm run dist
```
Find your builds in `app/dist/`.

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.
