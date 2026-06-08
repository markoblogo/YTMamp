const assert = require('assert');
const test = require('node:test');

function makeElement({ tagName = 'BUTTON', attrs = {}, className = '', id = '', children = [] } = {}) {
    const el = {
        tagName,
        className,
        id,
        children,
        value: 0,
        volume: 0.5,
        clicked: false,
        innerText: '',
        click() { this.clicked = true; },
        getAttribute(name) { return attrs[name] || null; },
        dispatchEvent() { return true; },
        querySelector(selector) {
            return findMatch(this.children, selector);
        },
        querySelectorAll(selector) {
            return findAll(this.children, selector);
        }
    };
    return el;
}

function matches(el, selector) {
    if (selector.startsWith('#')) return el.id === selector.slice(1);
    if (selector.startsWith('.')) return el.className.split(/\s+/).includes(selector.slice(1));
    if (selector === 'button' || selector === '[role="button"]' || selector === 'tp-yt-paper-icon-button') {
        return el.tagName === 'BUTTON' || el.tagName === 'TP-YT-PAPER-ICON-BUTTON';
    }
    if (selector.startsWith('button[aria-label*="')) {
        const text = selector.match(/"([^"]+)"/)?.[1] || '';
        return el.tagName === 'BUTTON' && (el.getAttribute('aria-label') || '').includes(text);
    }
    return el.tagName.toLowerCase() === selector.toLowerCase();
}

function findAll(children, selectorList) {
    const selectors = selectorList.split(',').map((selector) => selector.trim());
    const out = [];
    for (const child of children) {
        if (selectors.some((selector) => matches(child, selector))) out.push(child);
        out.push(...findAll(child.children || [], selectorList));
    }
    return out;
}

function findMatch(children, selectorList) {
    return findAll(children, selectorList)[0] || null;
}

function loadAdapter(root, media = null) {
    global.window = {};
    global.document = {
        querySelector(selector) {
            if (selector === 'ytmusic-player-bar') return root;
            if (selector === 'video' || selector === 'audio') return media;
            if (selector === '#volume-slider') return null;
            return null;
        }
    };
    delete require.cache[require.resolve('../../extension/src/ytm_adapter.js')];
    return require('../../extension/src/ytm_adapter.js').YTM_ADAPTER;
}

test('control clicks standard player buttons', async () => {
    const play = makeElement({ id: 'play-pause-button' });
    const root = makeElement({ tagName: 'YTMUSIC-PLAYER-BAR', children: [play] });
    const adapter = loadAdapter(root);

    assert.equal(await adapter.playPause(1), true);
    assert.equal(play.clicked, true);
});

test('control uses aria-label fallback for new commands', async () => {
    const shuffle = makeElement({ attrs: { 'aria-label': 'Shuffle playlist' } });
    const root = makeElement({ tagName: 'YTMUSIC-PLAYER-BAR', children: [shuffle] });
    const adapter = loadAdapter(root);

    assert.equal(await adapter.shuffle(2), true);
    assert.equal(shuffle.clicked, true);
});

test('control returns false when player bar is missing', async () => {
    const adapter = loadAdapter(null);
    assert.equal(await adapter.next(3), false);
});

test('setVolume falls back to media element', () => {
    const video = makeElement({ tagName: 'VIDEO' });
    const adapter = loadAdapter(null, video);

    assert.equal(adapter.setVolume(0.42), 'ok');
    assert.ok(Math.abs(video.volume - 0.42) < 0.05);
});
