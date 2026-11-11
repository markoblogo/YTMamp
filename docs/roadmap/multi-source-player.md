# YTMamp multi-source player

Owner scope, 11 November 2026: a retro macOS player that starts in local mode, with optional YouTube Music, internet radio and a local vinyl view. Music is already organized in folders. **Whole-computer audio discovery is excluded.** Audio stays in its original folders, including external drives.

## Delivery sequence

Each stage is implemented and verified independently before starting the next one.

| Stage | Deliverable | Completion check |
| --- | --- | --- |
| 1 | Single selected folder and subfolders; local playback, queue, transport controls, local default, existing YT bridge switch | Play and seek real audio; next/previous, shuffle/repeat, errors, restore selected folder, source isolation; macOS listening check |
| 2 | Several explicitly added folders; persistent library, tags, album art and search within those folders | Restart without duplicate entries; disconnected external drive; no music copied; bounded metadata cache |
| 3 | Radio by genre, favorites, custom stream URLs and reconnect handling | Working streams, dead-stream feedback, cached directory and reliable source switching |
| 4 | YT Music playlist selection and optional playback inside the app | Owner login and playlist tested on Mac; existing browser companion remains a supported fallback |
| 5 | Local vinyl view based on rauchg/vinyl | Visual deck follows the same local queue and controls; no hidden animation workload; CPU/RAM measured on owner's Mac |
| 6 | macOS release polish and installer | Finder open-with, media keys, sleep/wake, external-drive recovery, Apple Silicon package and installation smoke |

Stage 5 initially adapts the visual deck to normal local audio. The original vinyl project also performs physical groove/stylus simulation and pre-processes imported audio. Full sound simulation is a separately measured enhancement after the visual version; it must not delay normal playback or create an unbounded cache.

## Candidate donors reviewed

These are candidates, not bundled applications. Stages 1 and 2 keep the existing renderer and player; stage 2 adds only the MIT-licensed `music-metadata` parser and its dependencies for tag reading.

| Project | License reported by repository | Useful parts | Integration decision |
| --- | --- | --- | --- |
| [Webamp](https://github.com/captbaritone/webamp) | MIT | Browser audio, playlists, retro UI interactions and optional Butterchurn integration | Closest web technology reference; borrow narrow modules if they beat the existing small renderer |
| [Museeks](https://github.com/martpie/museeks) | MIT | Local library, playlists, queue and metadata workflows | Current version uses Tauri/Rust and React; reference design and data flow, not a drop-in Electron backend |
| [Radio Browser](https://docs.radio-browser.info/) | Public directory/API; service is not a bundled code donor | Genre tags, station search, resolved stream URLs and health fields | Preferred directory source, with favorites and cached results independent of service uptime |
| [Radiola](https://github.com/SokoloffA/radiola) | MIT | macOS radio UX, station management and history | Native Swift code needs adaptation; useful reference for radio stage |
| [Pear Desktop](https://github.com/pear-devs/pear-desktop) | MIT | Electron YouTube Music integration and plugin architecture | Inspect account/session/player integration in stage 4; do not import its whole application |
| [vinyl](https://github.com/rauchg/vinyl) | MIT for code | WebGL2 deck, record/arm mechanics, optional Web Audio simulation | Adapt renderer for stage 5; preserve attribution and handle bundled recordings under their own licenses |
| [Musicat](https://github.com/basharovV/musicat) | GPL-3.0 | Rich local library, tagging and playlists | Product reference; avoid copying GPL code into the current MIT codebase without an explicit licensing decision |

Before copying any module, verify the actual license file and file-level notices at the selected commit. Prefer existing platform APIs over adding an entire donor's runtime, UI framework or database.

## Stage 1 behavior

- The app always starts in LOCAL mode, paused. FOLDER opens a native directory picker; LIST expands the local queue. Selecting a track starts it. Closing the folder picker does not change the queue.
- Supported filename extensions: MP3, WAV, FLAC, M4A, AAC, OGG and OPUS. Actual codec support is determined by Electron; unreadable or unsupported files show an error and do not trigger an endless skip loop.
- Tracks are displayed by filename and relative directory. Embedded tags, covers, multiple roots and library search belong to stage 2.
- The last folder, selected track and local volume are saved. Restart re-reads only that folder and restores it paused. A missing drive can be reconnected and selected again.
- Import skips hidden entries and symlinks and stops at 5,000 tracks or 50,000 examined entries. The UI reports limits, skipped directories and cancelation. These are per-folder limits, not a machine-wide discovery feature.
- Audio is streamed from its original file through a custom protocol with queue IDs, path containment checks and byte-range support. The renderer receives neither arbitrary filesystem access nor absolute paths.
- LOCAL and YT share the existing metadata/state API. Inactive YouTube reports cannot replace the local track. Switching pauses outgoing playback; switching back never starts music automatically.
- YT still uses the signed-in browser tab and companion extension in this stage. Update the companion from this branch for the new idempotent `pause` command used on source changes. The app does not download YouTube audio or make its playlists available offline.

## Validation

`npm run check`, `npm audit --audit-level=high` and `npm run pack` remain the release checks. `npm run test:desktop` adds a real Electron playback smoke using generated WAV files, muted output, isolated settings and a stubbed native folder picker. It verifies decoding, waveform data, seeking, queue controls, source switching and error handling without reading the owner's music. Linux CI runs it under Xvfb.

The desktop automation does not replace the owner's macOS listening check. Before stage 1 is called release-ready, verify an actual music folder on the Mac, including YT source switching with the updated companion. Do not tag or merge solely because packaging succeeded.

Stage 1 produced an ad-hoc signed Apple Silicon preview and matching v0.5.0 companion as `YTMamp-stage1-macos-arm64`. The owner installed and confirmed local playback on the Mac. These are preview artifacts, not a tagged public release.

## Stage 2 behavior

- **ADD** accepts multiple folders and adds them to the saved collection. Existing stage 1 settings migrate automatically. Parent/child selections share one track entry; removing either root leaves tracks that are still covered by another root.
- **LIBRARY** expands to 700 × 560, with tracks, albums, a folder selector and search across title, artist, album, album artist, genre, year and relative filename. Search ignores case and accents and requires all entered words to match. Browsing and searching do not change playback.
- Embedded tags are read without rewriting files. Missing title/artist/album values use filename, Unknown artist and parent-folder labels. Albums use album artist plus album name, or the physical folder when no album tag exists. Disc and track numbers determine album playback order.
- **Play album** sets a queue within that album; the last track stops unless repeat or shuffle is enabled. Selecting a track in the full collection restores the full collection queue.
- Embedded front covers are preferred. If no supported embedded picture exists, the containing folder is checked for `cover.jpg`, `cover.png`, `folder.jpg`, `folder.png`, `front.jpg`, `front.png` or `cover.webp`. JPEG, PNG and WebP pictures up to 2 MiB are accepted. Missing or evicted art uses a placeholder.
- Only selected roots are rescanned, at startup or **Refresh**. Unchanged files reuse saved tags. Root and metadata updates commit atomically; cancelation leaves the previous collection intact. Adding/refreshing does not reload the playing track while it remains available.
- Offline roots retain cached metadata and artwork for browsing/search. Their tracks cannot play until the drive returns and **Refresh** succeeds. Removing a root changes the library only; original files are never deleted.
- Limits: 20 roots, 10,000 unique tracks across the collection, 5,000 tracks/50,000 entries examined per root, 16 MiB manifest and 32 MiB artwork cache. The renderer receives opaque IDs, relative labels and controlled artwork URLs. No audio files are copied.
- Parsing runs sequentially in one worker with a per-file timeout and memory limits. There is no background whole-machine discovery, tag editor, radio or vinyl engine in this stage.

`npm run test:library:desktop` uses generated tagged WAVs and an isolated profile to check actual metadata, artwork decoding, search, playback continuity while adding roots, album boundaries, reconnect and safe removal. CI also exercises the metadata worker from the signed Mac package's ASAR. The stage 2 artifact is `YTMamp-stage2-macos-arm64`, version 0.6.0. Manual Mac listening and real browser authentication remain separate from these automated checks.
