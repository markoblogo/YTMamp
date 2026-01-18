console.log('[YTMamp] Content script loaded');

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.v !== 1) return;

    console.log(`[YTMamp] Received CMD: [ID:${request.id || 'N/A'}] ${request.cmd || request.type}`);

    if (request.type === 'cmd') {
        const cmdId = request.id || 'N/A';
        switch (request.cmd) {
            case 'playPause':
                window.YTM_ADAPTER.playPause(cmdId);
                break;
            case 'next':
                window.YTM_ADAPTER.next(cmdId);
                break;
            case 'prev':
                window.YTM_ADAPTER.prev(cmdId);
                break;
            case 'setVolume':
                const res = setGainVolume(request.value);
                console.log(`[YTMamp] setVolume [ID:${request.id}] result: ${res}`);
                chrome.runtime.sendMessage({ type: 'volStatus', v: 1, status: res });
                break;
            case 'seek':
                const media = getMediaEl();
                if (media && request.valueSec !== undefined) {
                    if (isFinite(request.valueSec)) {
                        media.currentTime = request.valueSec;
                        console.log(`[YTMamp] Seek [ID:${request.id}] to: ${request.valueSec}`);
                    }
                }
                break;
            default:
                console.log(`[YTMamp] Unknown command: ${request.cmd}`);
        }
        sendResponse({ ok: true });
    }
});

function setGainVolume(value) {
    // value is 0.0 to 1.0
    if (gainNode) {
        gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.05);
        console.log(`[YTMamp] Gain set to ${value}`);
        return 'ok';
    }
    // Fallback to adapter's DOM manipulation
    return window.YTM_ADAPTER.setVolume(value);
}

let lastSentVolume = -1;
function reportTrack(info) {
    const rawVolume = window.YTM_ADAPTER.getVolume();
    const volume = Math.round(rawVolume * 100) / 100;

    // Only send volume if it changed significantly (> 0.03) or first time
    const delta = Math.abs(volume - lastSentVolume);
    const shouldSendVolume = lastSentVolume === -1 || delta >= 0.03;

    const msg = {
        type: 'track',
        v: 1,
        title: info.title,
        artist: info.artist
    };

    if (shouldSendVolume) {
        msg.volume = volume;
        lastSentVolume = volume;
        console.log(`[YTMamp] Sharing volume: ${volume} (delta: ${delta.toFixed(3)})`);
    }

    chrome.runtime.sendMessage(msg);
}

// Watch for changes
window.YTM_ADAPTER.watchNowPlaying(reportTrack);

// --- Playback State Loop ---
let lastPlayingState = false;
setInterval(() => {
    const media = getMediaEl();
    if (media) {
        const isPlaying = !media.paused;

        // Detect transition from paused to playing
        if (isPlaying && !lastPlayingState) {
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().then(() => console.log('[YTMamp] AudioContext resumed on play'));
            }
            chrome.storage.sync.get({ autoShow: true }, (data) => {
                if (data.autoShow) {
                    chrome.runtime.sendMessage({ type: 'event', name: 'playingStarted', v: 1 });
                }
            });
        }
        lastPlayingState = isPlaying;

        chrome.runtime.sendMessage({
            type: 'state',
            v: 1,
            positionSec: media.currentTime,
            durationSec: media.duration,
            playing: isPlaying
        });
    }
    // Auto-hide miniplayer periodically
    hideYtmMiniPlayer();
}, 500);

function hideYtmMiniPlayer() {
    // Selectors for YTM and general YouTube miniplayer close buttons
    const selectors = [
        'ytmusic-player-bar .close-button',
        '.ytp-miniplayer-close-button',
        'button[aria-label*="Close miniplayer"]',
        'button[aria-label*="Закрыть мини-плеер"]',
        '#close-button.ytmusic-player-bar'
    ];

    for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn && btn.offsetParent !== null) { // exists and is visible
            console.log(`[YTMamp] miniplayer: detected via "${selector}", closing...`);
            btn.click();
            return true;
        }
    }
    return false;
}

// --- Waveform Logic ---
let audioCtx, analyser, gainNode, dataArray, currentSource;
let sources = new WeakMap(); // mediaElement -> MediaElementSourceNode
let currentMediaEl = null;
let flatDataCounter = 0;
let isWaveLoopRunning = false;

function getMediaEl() {
    return document.querySelector('video') || document.querySelector('audio');
}

function setupAudioCapture() {
    const media = getMediaEl();
    if (!media) {
        console.warn('[YTMamp] wave: no media element found');
        chrome.runtime.sendMessage({ type: 'waveFallback', v: 1, reason: 'No media element' });
        return;
    }

    if (currentMediaEl === media && audioCtx && audioCtx.state !== 'closed') {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return;
    }

    try {
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        // 1. Disconnect previous graph if exists
        if (currentSource) {
            try { currentSource.disconnect(); } catch (e) { }
        }
        if (gainNode) {
            try { gainNode.disconnect(); } catch (e) { }
        }
        if (analyser) {
            try { analyser.disconnect(); } catch (e) { }
        }

        // 2. Setup Nodes
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        gainNode = audioCtx.createGain();

        // 3. Get/Create Source
        let source = sources.get(media);
        if (!source) {
            source = audioCtx.createMediaElementSource(media);
            sources.set(media, source);
            console.log('[YTMamp] wave: created new source for', media.tagName);
        } else {
            console.log('[YTMamp] wave: reusing existing source for', media.tagName);
        }

        // 4. Connect Graph
        source.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(audioCtx.destination);

        currentSource = source;
        currentMediaEl = media;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        console.log('[YTMamp] wave: graph connected successfully');

        if (!isWaveLoopRunning) {
            isWaveLoopRunning = true;
            startStreamLoop();
        }
    } catch (e) {
        console.error('[YTMamp] wave: capture failed:', e);
        chrome.runtime.sendMessage({ type: 'waveFallback', v: 1, reason: e.message });
    }
    hideYtmMiniPlayer();
}

function startStreamLoop() {
    requestAnimationFrame(function stream() {
        const media = getMediaEl();

        if (!analyser || media !== currentMediaEl) {
            if (media && media !== currentMediaEl) {
                console.log('[YTMamp] wave: media element changed, re-binding...');
                setupAudioCapture();
            }
            isWaveLoopRunning = false;
            return;
        }

        analyser.getByteTimeDomainData(dataArray);

        // Silence/Flat detection
        let isFlat = true;
        for (let i = 0; i < dataArray.length; i++) {
            if (Math.abs(dataArray[i] - 128) > 2) {
                isFlat = false;
                break;
            }
        }

        if (isFlat) {
            flatDataCounter++;
            if (flatDataCounter > 30) { // ~1.5s
                const reason = (media && media.paused) ? 'Media paused' : 'Silent data';
                chrome.runtime.sendMessage({ type: 'waveFallback', v: 1, reason });
            }
        } else {
            flatDataCounter = 0;
            const data = Array.from(dataArray).filter((_, i) => i % 2 === 0);
            chrome.runtime.sendMessage({ type: 'wave', v: 1, data });
        }

        setTimeout(() => requestAnimationFrame(stream), 50); // ~20fps
    });
}

// Watch for DOM changes to detect new media elements
const domObserver = new MutationObserver(() => {
    const media = getMediaEl();
    if (media && media !== currentMediaEl) {
        console.log('[YTMamp] wave: new media detected via Observer');
        setupAudioCapture();
    }
    hideYtmMiniPlayer();
});
domObserver.observe(document.body, { childList: true, subtree: true });

// Browser interaction to resume context
['click', 'mousedown', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }, { once: false, passive: true });
});

// Start
setupAudioCapture();
