# Browser support

YTMamp uses a Chromium extension to bridge YouTube Music with the desktop app.

## Tested browsers

These Chromium-based browsers have been manually tested:

- Chrome
- Comet
- Atlas

## Expected compatibility

Other Chromium-based browsers may work if they support:

- Manifest V3 extensions
- unpacked extension loading
- `chrome.tabs`
- `chrome.storage`
- content scripts on `https://music.youtube.com/*`

Examples likely to work but not yet listed as tested: Brave, Edge, Arc-style Chromium browsers.

## Install note

Extensions are installed per browser profile. If you use more than one browser or profile, load the unpacked `extension/` folder in each one.
