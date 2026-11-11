# Release smoke plan

## v0.4.0 release candidate

Automated gates run on macOS, Windows, and Ubuntu:

- clean dependency install;
- JavaScript lint and unit/integration tests;
- production dependency audit;
- unpacked Electron package build;
- API smoke-summary and checklist validation.

Before publishing v0.4.0, manually confirm on each supported platform:

1. App launches and tray/menu icon appears.
2. **Copy bridge token** pairs a newly loaded extension.
3. Play/pause, previous, next, seek, volume, like, shuffle, and repeat work.
4. Waveform begins after one user interaction with the YouTube Music page.
5. Hide/show, media keys, reconnect, and quit behave correctly.
6. Each published installer launches from a clean install.

Observed locally on macOS on 2026-09-11: both the source app and packaged arm64 app started, the main window reported visible, the WebSocket bridge listened on loopback, and `GET /status` returned HTTP 200 with API version 1. Browser pairing and clean-install checks remain pending.

Record automated CI, release asset publication, and manual runtime checks separately. The v0.3.3 matrix in repository history is evidence for that release, not for v0.4.0.
# Local folder playback (development branch)

- Launch without network or companion: LOCAL is selected and playback is paused.
- Open a music folder containing nested folders. LIST shows the queue; the picker cancel action preserves the previous queue. Selecting a track plays it from its original location.
- Check MP3, WAV, FLAC and M4A samples available on the test machine. Check pause/resume, seek, previous/next, shuffle and repeat. Verify audible output and that the oscilloscope reacts to audio.
- Restart: the same folder/track and volume return paused. No audio copies appear in app data.
- Disconnect/reconnect an external drive; verify actionable feedback and successful folder re-selection. Check a corrupt file and an empty folder.
- Switch to YT MUSIC with the updated companion and a signed-in tab. Verify YT controls. Switch back to LOCAL: outgoing YT pauses, local metadata returns and local audio stays paused until Play.
- `npm run test:desktop` covers generated WAV playback, analyzer output, seek, pause, next, switching and bad files with muted output and isolated settings. macOS listening, actual YT authentication and external-drive recovery remain separate interactive checks.

## Stage 2 music library (0.6.0 development preview)

Automated coverage is separate from the following owner checks:

1. Update the existing Mac app while retaining its profile. Confirm the stage 1 folder and selected track migrate, with LOCAL selected and playback paused.
2. Use ADD to select two music folders. Confirm tags, embedded covers and folder covers; nested/overlapping folders do not duplicate tracks.
3. Open LIBRARY. Search by artist, album, Cyrillic text and genre; test the folder filter and no-results feedback. Switch between tracks and albums without interrupting audio.
4. Play an album with numbered tracks. Confirm its queue ends at the album boundary; repeat/shuffle remain scoped to that queue. Add or refresh another folder during playback and confirm continuity.
5. Restart. Disconnect an external music drive and refresh: its albums remain searchable but offline. Reconnect and refresh, then play again.
6. Remove one root from the library. Verify its original files are intact and overlapping tracks still belong to any remaining root. Test canceling a large import.
7. Confirm the mini-player remains compact and the expanded library stays within the display. Check audible output on representative MP3, FLAC, M4A and WAV files.

`npm run test:library:desktop` covers generated tagged WAV decoding, image decoding, multiple roots, accent-insensitive search, album playback boundaries, offline/reconnect and safe removal under Linux Xvfb. Unit tests cover restart, cancellation, containment, cache budgets and public catalog fields. A Mac CI check loads the real metadata worker and parser from the signed app's ASAR. These checks use generated music and temporary profiles, not the owner's collection.
