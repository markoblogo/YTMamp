# Cross-platform packaging

YTMamp targets macOS, Windows, and Linux. GitHub Actions builds each desktop format on its native runner and publishes the Chromium extension as a separate ZIP.

| Platform | Release assets | Runtime checks still required |
| --- | --- | --- |
| macOS | DMG, ZIP | Gatekeeper launch, menu bar, media keys, login item |
| Windows | NSIS EXE, ZIP | SmartScreen launch, tray, media keys, startup |
| Linux | AppImage, DEB | launch, tray/AppIndicator, media keys, autostart |
| Chromium | extension ZIP | load unpacked, token pairing, YouTube Music control |

CI validates an unpacked Electron package on all three desktop runners. This catches packaging failures but does not replace the interactive checks above. Release builds are unsigned and not notarized.
