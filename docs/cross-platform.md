# Cross-platform release notes

YTMamp v0.3.0 adds first-class packaging targets for macOS, Windows, and Linux.

## Release assets

Expected assets for a `v0.3.0` release:

- `YTMamp-0.3.0-mac.dmg`
- `YTMamp-0.3.0-mac.zip`
- `YTMamp-0.3.0-win.exe`
- `YTMamp-0.3.0-win.zip`
- `YTMamp-0.3.0-linux.AppImage`
- `YTMamp-0.3.0-linux.deb`

## Platform smoke checklist

### macOS

- DMG opens and installs into `/Applications`.
- Menu bar tray icon appears.
- Tray menu can show/hide and quit the app.
- Start at login toggle persists and applies through Electron login item settings.
- App connects to the unpacked extension in a tested Chromium browser.

### Windows

- NSIS installer completes and creates Start menu entry.
- ZIP build launches after extraction.
- System tray icon appears.
- Tray menu can show/hide and quit the app.
- Start at login toggle persists and applies through Electron login item settings.
- App connects to the unpacked extension in a tested Chromium browser.

### Linux

- AppImage launches after `chmod +x`.
- DEB installs and launches on Ubuntu/Debian.
- Tray icon appears on desktops with tray/AppIndicator support.
- Tray menu can show/hide and quit the app.
- Start at login creates/removes `~/.config/autostart/ytmamp.desktop`.
- App connects to the unpacked extension in a tested Chromium browser.

## Notes

- Linux tray behavior depends on the desktop environment. GNOME setups may need AppIndicator support.
- Linux autostart uses the XDG autostart desktop entry path rather than Electron login item settings.
- Browser extension setup remains unpacked and per browser profile.
