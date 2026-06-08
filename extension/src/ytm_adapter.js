/**
 * YTMamp Adapter - Robust DOM control
 */

const YTM_SELECTORS = {
    PLAYER_BAR: 'ytmusic-player-bar',
    CONTROL_GROUP: '.left-controls, .middle-controls, .right-controls',
    // Fallback search strings for aria-labels/titles
    LABELS: {
        playPause: ['Play', 'Pause', 'воспроизвести', 'пауза', 'jouer'],
        next: ['Next', 'следующий', 'suivant'],
        prev: ['Previous', 'предыдущий', 'précédent'],
        like: ['Like', 'Нравится', "J'aime"],
        dislike: ['Dislike', 'Не нравится', "Je n'aime pas"],
        shuffle: ['Shuffle', 'Перемешать', 'Aléatoire'],
        repeat: ['Repeat', 'Повтор', 'Répéter']
    }
};

function findPlayerBar() {
    return document.querySelector(YTM_SELECTORS.PLAYER_BAR);
}

function logBarState(root) {
    if (!root) return 'Player bar not found';
    try {
        const controls = root.querySelector('.middle-controls');
        return `PlayerBar: ${root.outerHTML.substring(0, 500)}... MiddleControls: ${controls ? controls.innerHTML : 'Not found'}`;
    } catch (e) {
        return 'Failed to dump DOM: ' + e.message;
    }
}

const YTM_ADAPTER = {
    /**
     * Standardized clicker with fallbacks
     * @param {string} type - 'playPause', 'next', 'prev'
     * @param {number} cmdId - for logging
     */
    async control(type, cmdId) {
        const root = findPlayerBar();
        if (!root) {
            console.error(`[YTMamp] [ID:${cmdId}] Failed: Player bar not found.`);
            return false;
        }

        console.log(`[YTMamp] [ID:${cmdId}] Attempting ${type}...`);

        // Fallback 1: CSS Selectors (Modern YTM)
        const selectors = {
            playPause: ['#play-pause-button', '.play-pause-button'],
            next: ['.next-button', 'tp-yt-paper-icon-button.next-button'],
            prev: ['.previous-button', 'tp-yt-paper-icon-button.previous-button'],
            like: ['tp-yt-paper-icon-button.like', '#button-shape-like', 'button[aria-label*="Like"]'],
            dislike: ['tp-yt-paper-icon-button.dislike', '#button-shape-dislike', 'button[aria-label*="Dislike"]'],
            shuffle: ['.shuffle', 'tp-yt-paper-icon-button[title*="Shuffle"]', 'button[aria-label*="Shuffle"]'],
            repeat: ['.repeat', 'tp-yt-paper-icon-button[title*="Repeat"]', 'button[aria-label*="Repeat"]']
        };

        for (const sel of selectors[type]) {
            const el = root.querySelector(sel);
            if (el && typeof el.click === 'function') {
                console.log(`[YTMamp] [ID:${cmdId}] Match found via Selector: ${sel}`);
                el.click();
                return true;
            }
        }

        // Fallback 2: Aria-Label / Title partial match (Multi-lang)
        const possibleLabels = YTM_SELECTORS.LABELS[type];
        const allButtons = root.querySelectorAll('button, [role="button"], tp-yt-paper-icon-button');

        for (const btn of allButtons) {
            const label = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
            if (possibleLabels.some(p => label.includes(p.toLowerCase()))) {
                console.log(`[YTMamp] [ID:${cmdId}] Match found via Label: "${label}"`);
                btn.click();
                return true;
            }
        }

        // Fallback 3: Index based (Hard fallback)
        // Usually: [0] Prev, [1] Play/Pause, [2] Next in the middle controls area
        const middleControls = root.querySelector('.middle-controls-buttons');
        if (middleControls) {
            const buttons = Array.from(middleControls.children).filter(c => c.tagName !== 'YTM-PLAYER-BAR-WAVEFORM'); // skip waveform if it's there
            const indexMap = { prev: 0, playPause: 1, next: 2 };
            const targetIndex = indexMap[type];
            if (buttons[targetIndex]) {
                console.log(`[YTMamp] [ID:${cmdId}] Match found via Index: ${targetIndex} of ${buttons.length}`);
                buttons[targetIndex].click();
                return true;
            }
        }

        // Failure
        console.error(`[YTMamp] [ID:${cmdId}] CRITICAL: Could not find ${type} button after 3 fallbacks.`);
        console.debug(`[YTMamp] [ID:${cmdId}] DOM State:`, logBarState(root));
        return false;
    },

    // Legacy Wrappers for compatibility during migration
    playPause(cmdId) { return this.control('playPause', cmdId); },
    next(cmdId) { return this.control('next', cmdId); },
    prev(cmdId) { return this.control('prev', cmdId); },
    like(cmdId) { return this.control('like', cmdId); },
    dislike(cmdId) { return this.control('dislike', cmdId); },
    shuffle(cmdId) { return this.control('shuffle', cmdId); },
    repeat(cmdId) { return this.control('repeat', cmdId); },

    getNowPlaying() {
        const root = findPlayerBar();
        if (!root) return null;

        const titleEl = root.querySelector('.middle-controls .title') ||
            root.querySelector('yt-formatted-string.title');

        const bylineEl = root.querySelector('.middle-controls .byline') ||
            root.querySelector('yt-formatted-string.byline');

        return {
            title: titleEl?.innerText || 'Unknown Title',
            artist: bylineEl?.innerText || 'Unknown Artist'
        };
    },

    watchNowPlaying(onChange) {
        const root = findPlayerBar();
        if (!root) {
            setTimeout(() => this.watchNowPlaying(onChange), 1000);
            return;
        }

        let timeout;
        const observer = new MutationObserver(() => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                const info = this.getNowPlaying();
                if (info) onChange(info);
            }, 300);
        });

        observer.observe(root, { childList: true, subtree: true, characterData: true });
        return observer;
    },

    setVolume(value01) {
        const media = document.querySelector('video') || document.querySelector('audio');
        if (media) {
            media.volume = value01;
            if (Math.abs(media.volume - value01) < 0.05) return 'ok';
        }

        const uiSlider = document.querySelector('#volume-slider');
        if (uiSlider) {
            try {
                uiSlider.value = value01 * 100;
                uiSlider.dispatchEvent(new Event('input', { bubbles: true }));
                uiSlider.dispatchEvent(new Event('change', { bubbles: true }));
                return 'fallback';
            } catch (e) { }
        }
        return 'blocked';
    },

    getVolume() {
        const media = document.querySelector('video') || document.querySelector('audio');
        return media ? media.volume : 0.5;
    }
};

window.YTM_ADAPTER = YTM_ADAPTER;

if (typeof module !== 'undefined') {
    module.exports = { YTM_ADAPTER, YTM_SELECTORS, findPlayerBar };
}
