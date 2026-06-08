# Changelog

All notable changes to this project will be documented in this file.

## [0.3.1] - 2026-06-09
### Added
- Stabilization notes for Windows and Linux release artifacts and manual smoke checks.
- Documented verified desktop/browser matrix for users and contributors.

### Changed
- Updated app/extension versions to `0.3.1` for the stabilization patch release.
- Cleaned up tray lifecycle and autostart wiring for cross-platform shutdown and reconnect paths.

### Fixed
- Added defensive tray click guard when window is not available.
- Improved Windows/macOS autostart behavior to avoid hidden startup mode.
- Ensured tray object is released on app shutdown.

## [0.3.0] - 2026-06-09
### Added
- Windows release targets: NSIS installer and ZIP archive.
- Linux release targets: AppImage and DEB package.
- Cross-platform CI matrix for macOS, Windows, and Ubuntu.
- Linux autostart support via `~/.config/autostart/ytmamp.desktop`.
- Platform-specific installation and smoke-test documentation.

### Changed
- Release workflow now builds platform assets on matching GitHub-hosted runners.
- Local build scripts now expose `dist:mac`, `dist:win`, and `dist:linux`.

## [0.2.0] - 2026-06-08
### Added
- Like, dislike, shuffle, and repeat command support.
- Window position persistence across app sessions.
- WebSocket protocol validation and track metadata normalization.
- Unit and integration tests plus CI checks for lint/test on pushes and pull requests.

### Changed
- Reworked renderer-to-extension command relay to use one global IPC listener.
- Replaced tight playback polling with media-element events and a slower fallback loop.
- Reduced waveform payload frequency and bin count for lower content-script overhead.
- Updated tray menu refresh to reuse the existing system tray instance.

### Fixed
- Prevented stale IPC listeners after broken WebSocket connections.
- Added disconnected tab state so the app does not keep showing stale track data.

## [0.1.0] - 2026-01-19
### Added
- Initial public release of YTMamp.
- Electron-based mini-player for macOS.
- Chrome Extension (unpacked) to bridge YouTube Music with the desktop app.
- Retro-modern UI with neon green accents.
- Oscilloscope (waveform visualizer) with fallback animation.
- Media controls (Play/Pause, Next, Prev, Seek).
- Volume control with GainNode support.
- Auto-show player on playback start.
- Auto-hide native YTM mini-player overlay.
- System tray integration with visibility toggles.
- Automated DMG and ZIP packaging for macOS.
