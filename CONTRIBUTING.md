# Contributing to YTMamp

## Set up

```bash
git clone https://github.com/markoblogo/YTMamp.git
cd YTMamp/app
npm ci
npm run check
npm start
```

To test the companion, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/`.

## Before a pull request

Run these checks from `app/`:

```bash
npm run check
npm audit --audit-level=high
npm run pack
```

Describe any interactive desktop/browser checks separately. A successful package build does not prove tray, media-key, browser, or playback behavior.

Keep the black and neon-green compact interface, do not add DRM or ad-bypass behavior, and preserve the security invariants in [AGENTS.md](AGENTS.md). If a release version changes, update the app package, lockfile, and extension manifest together.
