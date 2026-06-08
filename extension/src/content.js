console.log('[YTMamp] Content script loaded');

const WAVE_SEND_INTERVAL_MS = 100;
const STATE_FALLBACK_INTERVAL_MS = 2000;
const WAVE_FFT_SIZE = 128;
const CONTROL_COMMANDS = new Set(['playPause', 'next', 'prev', 'like', 'dislike', 'shuffle', 'repeat']);

let audioCtx, analyser, gainNode, dataArray, currentSource;
let sources = new WeakMap();
let currentMediaEl = null;
let currentGraphMediaEl = null;
let mediaCleanup = null;
let flatDataCounter = 0;
let isWaveLoopRunning = false;
let lastWaveSentAt = 0;
let lastSentVolume = -1;
let lastPlayingState = false;
let domObserver = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.v !== 1) return;

    console.log(`[YTMamp] Received CMD: [ID:${request.id || 'N/A'}] ${request.cmd || request.type}`);

    if (request.type === 'cmd') {
        const cmdId = request.id || 'N/A';
        if (CONTROL_COMMANDS.has(request.cmd)) {
            window.YTM_ADAPTER[request.cmd](cmdId);
        } else if (request.cmd === 'setVolume') {
            const res = setGainVolume(clamp01(request.value));
            console.log(`[YTMamp] setVolume [ID:${request.id}] result: ${res}`);
            chrome.runtime.sendMessage({ type: 'volStatus', v: 1, status: res });
        } else if (request.cmd === 'seek') {
            const media = getMediaEl();
            if (media && Number.isFinite(request.valueSec) && request.valueSec >= 0) {
                media.currentTime = request.valueSec;
                console.log(`[YTMamp] Seek [ID:${request.id}] to: ${request.valueSec}`);
            }
        } else {
            console.log(`[YTMamp] Unknown command: ${request.cmd}`);
        }
        sendResponse({ ok: true });
    }
});

function clamp01(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function setGainVolume(value) {
    if (gainNode) {
        gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.05);
        console.log(`[YTMamp] Gain set to ${value}`);
        return 'ok';
    }
    return window.YTM_ADAPTER.setVolume(value);
}

function getMediaEl() {
    return document.querySelector('video') || document.querySelector('audio');
}

function reportTrack(info) {
    const rawVolume = window.YTM_ADAPTER.getVolume();
    const volume = Math.round(rawVolume * 100) / 100;
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

function sendState(media = getMediaEl()) {
    if (!media) return;
    const isPlaying = !media.paused;

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
        positionSec: Number.isFinite(media.currentTime) ? media.currentTime : 0,
        durationSec: Number.isFinite(media.duration) ? media.duration : 0,
        playing: isPlaying
    });
}

function bindMediaEvents(media) {
    if (!media || currentMediaEl === media) return;
    if (mediaCleanup) mediaCleanup();

    currentMediaEl = media;
    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'loadedmetadata'];
    const handler = () => sendState(media);
    events.forEach((eventName) => media.addEventListener(eventName, handler, { passive: true }));
    mediaCleanup = () => events.forEach((eventName) => media.removeEventListener(eventName, handler));
    sendState(media);
}

function hideYtmMiniPlayer() {
    const selectors = [
        'ytmusic-player-bar .close-button',
        '.ytp-miniplayer-close-button',
        'button[aria-label*="Close miniplayer"]',
        'button[aria-label*="Закрыть мини-плеер"]',
        '#close-button.ytmusic-player-bar'
    ];

    for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn && btn.offsetParent !== null) {
            console.log(`[YTMamp] miniplayer: detected via "${selector}", closing...`);
            btn.click();
            return true;
        }
    }
    return false;
}

function setupAudioCapture() {
    const media = getMediaEl();
    if (!media) {
        console.warn('[YTMamp] wave: no media element found');
        chrome.runtime.sendMessage({ type: 'waveFallback', v: 1, reason: 'No media element' });
        return;
    }

    bindMediaEvents(media);

    if (currentGraphMediaEl === media && audioCtx && audioCtx.state !== 'closed' && currentSource) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return;
    }

    try {
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (currentSource) {
            try { currentSource.disconnect(); } catch (e) { }
        }
        if (gainNode) {
            try { gainNode.disconnect(); } catch (e) { }
        }
        if (analyser) {
            try { analyser.disconnect(); } catch (e) { }
        }

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = WAVE_FFT_SIZE;
        gainNode = audioCtx.createGain();

        let source = sources.get(media);
        if (!source) {
            source = audioCtx.createMediaElementSource(media);
            sources.set(media, source);
            console.log('[YTMamp] wave: created new source for', media.tagName);
        } else {
            console.log('[YTMamp] wave: reusing existing source for', media.tagName);
        }

        source.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(audioCtx.destination);

        currentSource = source;
        currentGraphMediaEl = media;
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
    requestAnimationFrame(function stream(now) {
        const media = getMediaEl();

        if (!analyser || media !== currentGraphMediaEl) {
            if (media && media !== currentGraphMediaEl) {
                console.log('[YTMamp] wave: media element changed, re-binding...');
                currentSource = null;
                currentGraphMediaEl = null;
                setupAudioCapture();
            }
            isWaveLoopRunning = false;
            return;
        }

        if (now - lastWaveSentAt >= WAVE_SEND_INTERVAL_MS) {
            lastWaveSentAt = now;
            analyser.getByteTimeDomainData(dataArray);

            let isFlat = true;
            for (let i = 0; i < dataArray.length; i++) {
                if (Math.abs(dataArray[i] - 128) > 2) {
                    isFlat = false;
                    break;
                }
            }

            if (isFlat) {
                flatDataCounter++;
                if (flatDataCounter > 15) {
                    const reason = (media && media.paused) ? 'Media paused' : 'Silent data';
                    chrome.runtime.sendMessage({ type: 'waveFallback', v: 1, reason });
                }
            } else {
                flatDataCounter = 0;
                chrome.runtime.sendMessage({ type: 'wave', v: 1, data: Array.from(dataArray) });
            }
        }

        requestAnimationFrame(stream);
    });
}

function observePlayerDom() {
    if (domObserver) domObserver.disconnect();
    const root = document.querySelector('ytmusic-player-bar') || document.querySelector('#player') || document.body;
    domObserver = new MutationObserver(() => {
        const media = getMediaEl();
        if (media && media !== currentMediaEl) {
            console.log('[YTMamp] wave: new media detected via Observer');
            currentSource = null;
            currentGraphMediaEl = null;
            setupAudioCapture();
        }
        hideYtmMiniPlayer();
    });
    domObserver.observe(root, { childList: true, subtree: true });
}

window.YTM_ADAPTER.watchNowPlaying(reportTrack);
observePlayerDom();

setInterval(() => {
    const media = getMediaEl();
    if (media) {
        bindMediaEvents(media);
        sendState(media);
    }
    hideYtmMiniPlayer();
}, STATE_FALLBACK_INTERVAL_MS);

['click', 'mousedown', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: false, passive: true });
});

setupAudioCapture();
