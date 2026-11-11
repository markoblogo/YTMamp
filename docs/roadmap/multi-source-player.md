# YTMamp multi-source player

Owner scope, 11 November 2026: a retro macOS player that starts in local mode, with optional YouTube Music, internet radio and a local vinyl view. Music is already organized in folders. **Whole-computer audio discovery is excluded.** Audio stays in its original folders, including external drives.

## Delivery sequence

Each stage is implemented and verified independently before starting the next one.

Owner working agreement, 11 November 2026: work in bounded passes. State each pass's scope first; after its implementation/checks, report the result and open issues and stop for discussion. Do not roll directly into the next feature. Acceptance of one pass does not authorize starting every later pass without that discussion.

Current checkpoints:

- Stage 2 verification: accepted by the owner on 11 November after reporting that the player works. Mac UI checks confirmed 75%, 100%, 125% and 150% sizes through keyboard/menu controls and collapse while local playback continued. Automated tests cover restart, multiple roots and offline/reconnect; physical drive disconnection was not performed during that UI pass.
- The 0.6.1 hide button is included in the combined 0.7.0 radio preview. **X** remains Quit. Return is through the menu-bar/tray icon or Dock; the music library stays intact.
- Radio, station cards/search, a supplied-frequency local FM dial and independent WAV recording are implemented in PR #16. The owner installed 0.7.0 and confirmed local playback. Native testing reproduced successful direct AAC FIP playback and problems with HLS duplicates and stale errors. The 0.7.1 feedback fixes at `0fb02ce378d98c474b48ffcbc8bbfd6359665974` passed all three CI platforms, package/signature checks and generated-audio desktop tests. Its native location and installation checks are recorded separately in the smoke log.
- Owner sequencing update, 11 November: finish and test radio first; then conduct a separate project audit/sanitation/documentation pass, including README and GitHub About; then publish a verified release. Only after that exchange development ideas and agree a prioritized queue. Vinyl, embedded YouTube and other new ideas belong to later bounded passes.

| Stage | Deliverable | Completion check |
| --- | --- | --- |
| 1 | Single selected folder and subfolders; local playback, queue, transport controls, local default, existing YT bridge switch | Play and seek real audio; next/previous, shuffle/repeat, errors, restore selected folder, source isolation; macOS listening check |
| 2 | Several explicitly added folders; persistent library, tags, album art and search within those folders | Restart without duplicate entries; disconnected external drive; no music copied; bounded metadata cache |
| 3 | Radio by genre, favorites, custom stream URLs and reconnect handling | Working streams, dead-stream feedback, cached directory and reliable source switching |
| 4 | Project audit and sanitation, fixes, dependency/resource review, refreshed project documents/README and GitHub About | Review findings and fixes; remove obsolete generated/experimental material without touching user music/settings; align descriptions with implemented behavior and known limitations; rerun relevant checks; stop and report |
| 5 | Verified public release of the local-library/radio player | Finish release checks and Mac acceptance, reconcile stacked PRs, align versions, publish release notes/assets and verify downloads; stop and report |
| 6 | Owner/assistant idea exchange and prioritized development queue | Compare value, effort, runtime cost and dependencies; agree the next bounded block before implementing a new feature |

Deferred ideas for that queue include YT Music playlist selection/optional in-app playback, a local vinyl view based on rauchg/vinyl, further macOS integration and the owner's additional ideas. Their order is not fixed before the post-release discussion.

The future vinyl pass initially adapts the visual deck to normal local audio. The original vinyl project also performs physical groove/stylus simulation and pre-processes imported audio. Full sound simulation is a separately measured enhancement after the visual version; it must not delay normal playback or create an unbounded cache.

Owner UI requirement, 11 November 2026: keep the transport as the compact mini-player. The library/search and future vinyl deck are collapsible panels beneath it. Collapsing a panel preserves playback and its browsing state. A collapsed vinyl panel must suspend its animation/rendering workload; it must not stop the shared audio engine. Stage 2 provides both the LIBRARY toggle and an explicit COLLAPSE button; the vinyl panel belongs to a later post-release feature pass.

## Radio requirements for the next stage

0.7.1 owner feedback pass: local playback is confirmed good. Source onboarding now opens YT Music in the default browser when disconnected, automatically requests native macOS device location for local FM, removes manual city/country/region entry, loads the radio catalog, groups duplicate compatible streams, temporarily suppresses failed addresses and replaces stale errors with LIVE feedback. Prev/Next perform an animated SEEK sweep along known local frequencies, with the existing manual dial retained. No invented frequency or background RF scan. A native Core Location helper replaces the Google-dependent browser location provider on Mac. CI packaging passed. Native 0.7.1 Core Location resolved Nantes after the existing app-specific permission was enabled, but the directory supplied zero nearby frequency matches. Local FM acceptance therefore remains open.

The owner combined radio and the pending hide button into one 0.7.0 installation/test pass. Stop after that pass and review before starting YouTube embedding or vinyl.

- One LOCAL / YT MUSIC / RADIO source switch. The existing LIBRARY button opens the corresponding music or radio panel; COLLAPSE keeps playback running. No extra permanent catalog button.
- RADIO retains the waveform and volume, gives the mini-player a warm receiver face, and replaces track progress/duration with FM tuning. Prev/Next and the dial select only local stations in frequency order. A globally searched internet-only station can still play/pause in the mini-player, but never enters the local dial merely because it is playing.
- Worldwide station cards/search cover terrestrial streams and internet-only stations. Filters combine name, genre and language; sorting also includes country and region. Manual country/region entry was removed in the 0.7.1 feedback pass. Favorites and custom direct streams are saved independently of directory availability.
- Radio Browser has no separate transmitter-frequency field. The initial dial uses explicit FM/MHz labels plus station coordinates within 60 km, or frequencies the owner assigns to a station at the selected location. These are supplied metadata, not verified reception coverage. No invented station frequency or automatic classification from an unlabelled number. Initial band coverage is FM only, and the local list can be incomplete or empty. A city-based frequency provider is now a required follow-up for local FM acceptance: native Nantes testing produced zero matches from this directory. Arcom is the candidate primary source for France; it is not integrated yet.
- Entering RADIO requests device location for the local FM list. On macOS, the bundled Core Location helper handles system permission and Apple's city/country lookup. Coordinates are rounded before local persistence. Denied or unavailable location leaves the online catalog usable, with an explicit retry button. No manual city selection, IP-based location lookup or background tracking.
- REC / recording pause / STOP act independently of listening. Capture is stereo 48 kHz / 16-bit PCM WAV, streamed to a bounded private temporary file. STOP opens Save As, including external destinations. Cancel retains the pending file; Save As and Discard remain in the radio library. Source changes and normal quit prompt to save. A pending/interrupted recording is recovered on startup with its WAV header finalized to the actual PCM length.
- Short, volume-scaled tuning static is optional and kept outside the recording signal path. Recording is bounded at 512 MiB with a 256 MiB free-space reserve; no full-session RAM buffer or audio copies from the local collection.
- Direct streams use a controlled media protocol. Public HTTP(S) destinations only; DNS answers are checked and pinned per redirect. No renderer network access or general filesystem bridge is added. Initial decoder support follows Electron; HLS is explicitly unsupported rather than silently treated as MP3.

Implementation and generated-audio tests are in the radio branch. Native 0.7.1 is installed; device location works after permission is enabled. Complete native radio acceptance, including nearby FM data, remains open. The owner reported multiple dead catalog entries; 0.7.2 adds bounded, muted decoder checks before showing new cards, a 15-minute successful-check cache, a five-minute failed-address cooldown and progressive 24-record pages. The 0.7.2 code checkpoint passed all three CI platforms and Electron tests; its native installation is blocked by desktop-control timeouts, so the installed app remains 0.7.1. Exact artifact/checkpoint details and outstanding native checks are in the smoke log.

- A collapsible station panel using a grid of logos, visually analogous to album cards, with a fallback when a station has no usable logo.
- Search/filter by station name, music genre and broadcast language; sort also by country/region. Manual geographical fields were removed at the owner’s request.
- Sorting by name, genre, language and region. Unknown metadata must remain visibly unspecified rather than inferred.
- Keep the compact transport and scaling behavior. Source switching must stop the outgoing source so stations and local tracks do not play together.
- Add favorites, custom stream URLs and recovery/error feedback as planned for stage 3.

The owner requested one combined radio build and installation, followed by a test/review stop, instead of several small installations.

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
- **COLLAPSE** or the top **LIBRARY** toggle returns to the 360 × 116 mini-player. Reopening retains the query, folder filter and selected album, while audio continues on the same track.
- **Player size**, available by right click, tray and View menu, saves 75%, 100%, 125% or 150%. At 75% the mini-player is 270 × 87; at 100% it retains 360 × 116. Cmd/Ctrl `-`, `=` and `0` shrink, enlarge and reset. Controls scale together, and the expanded panel is bounded by the current display's work area. Resizing does not reload audio.
- Embedded tags are read without rewriting files. Missing title/artist/album values use filename, Unknown artist and parent-folder labels. Albums use album artist plus album name, or the physical folder when no album tag exists. Disc and track numbers determine album playback order.
- **Play album** sets a queue within that album; the last track stops unless repeat or shuffle is enabled. Selecting a track in the full collection restores the full collection queue.
- Embedded front covers are preferred. If no supported embedded picture exists, the containing folder is checked for `cover.jpg`, `cover.png`, `folder.jpg`, `folder.png`, `front.jpg`, `front.png` or `cover.webp`. JPEG, PNG and WebP pictures up to 2 MiB are accepted. Missing or evicted art uses a placeholder.
- Only selected roots are rescanned, at startup or **Refresh**. Unchanged files reuse saved tags. Root and metadata updates commit atomically; cancelation leaves the previous collection intact. Adding/refreshing does not reload the playing track while it remains available.
- Offline roots retain cached metadata and artwork for browsing/search. Their tracks cannot play until the drive returns and **Refresh** succeeds. Removing a root changes the library only; original files are never deleted.
- Limits: 20 roots, 10,000 unique tracks across the collection, 5,000 tracks/50,000 entries examined per root, 16 MiB manifest and 32 MiB artwork cache. The renderer receives opaque IDs, relative labels and controlled artwork URLs. No audio files are copied.
- Parsing runs sequentially in one worker with a per-file timeout and memory limits. There is no background whole-machine discovery, tag editor, radio or vinyl engine in this stage.

`npm run test:library:desktop` uses generated tagged WAVs and an isolated profile to check actual metadata, artwork decoding, search, playback continuity while adding roots, album boundaries, reconnect and safe removal. CI also exercises the metadata worker from the signed Mac package's ASAR. The stage 2 artifact is `YTMamp-stage2-macos-arm64`, version 0.6.0. Manual Mac listening and real browser authentication remain separate from these automated checks.
