// --- State & Handlers ---
let isSeeking = false;
let seekThrottleTimer = null;
let lastDuration = 0;
let commandCounter = 0;
let isDraggingVolume = false;
let volumeCooldownTimer = null;
let uiVolume = 0.5;
const DEBUG_OVERLAY = false;
const DEBUG_UI = false;

function sendCommand(type, cmd, extra = {}) {
    const id = ++commandCounter;
    const msg = { type, v: 1, cmd, id, ...extra };
    console.log(`[IPC] Sending CMD: [ID:${id}] ${cmd || type}`, extra);
    window.electronAPI.sendCommand(msg);
}

function formatTime(sec) {
    if (isNaN(sec) || sec === null || sec < 0) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

window.electronAPI.onStatusChange((status) => {
    const led = document.getElementById('status-led');
    const statusUpper = status.toUpperCase();

    led.className = ''; // reset
    if (statusUpper.includes('CONNECTED')) {
        led.classList.add('connected');
        led.title = 'Connected';
    } else if (statusUpper.includes('NEED') || statusUpper.includes('WAITING')) {
        led.classList.add('waiting');
        led.title = 'Reconnecting / Need Tab';
    } else {
        led.classList.add('offline');
        led.title = 'Offline';
    }
});

const canvas = document.getElementById('osc');
const ctx = canvas.getContext('2d');
let lastWaveData = null;
let lastWaveTime = 0;
let useFallback = false;
let fallbackOffset = 0;

window.electronAPI.onWaveUpdate((msg) => {
    if (msg.type === 'wave') {
        lastWaveData = msg.data;
        lastWaveTime = Date.now();
        useFallback = false;
    } else if (msg.type === 'waveFallback') {
        useFallback = true;
    }
});

function draw() {
    // Check if wave data is fresh
    if (!useFallback && Date.now() - lastWaveTime > 500) {
        useFallback = true;
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0f0';
    ctx.beginPath();

    if (useFallback) {
        // Fake wave animation
        for (let x = 0; x < canvas.width; x++) {
            const y = (canvas.height / 2) + Math.sin((x + fallbackOffset) * 0.1) * 8;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        fallbackOffset += 2;

        // NO WAVE indicator
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.font = '8px YTMamp';
        ctx.fillText('NO WAVE', 5, 10);
    } else if (lastWaveData) {
        const sliceWidth = canvas.width / lastWaveData.length;
        let x = 0;
        for (let i = 0; i < lastWaveData.length; i++) {
            const v = lastWaveData[i] / 128.0;
            const y = (v * canvas.height) / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
        }
    } else {
        // Static center line
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
    }

    ctx.stroke();
    requestAnimationFrame(draw);
}

draw();

window.electronAPI.onVolStatus((status) => {
    const el = document.getElementById('vol-status');
    el.innerText = `VOL: ${status.toUpperCase()}`;
    el.style.color = status === 'ok' ? '#00ff00' : (status === 'fallback' ? '#ffaa00' : '#ff0000');
});

// (Declarations moved to top)

window.electronAPI.onTrackUpdate((track) => {
    document.getElementById('title').innerText = track.title;
    document.getElementById('artist').innerText = track.artist;

    if (track.volume !== undefined) {
        const incomingVol = Math.round(track.volume * 100) / 100;

        // Conditions to ignore incoming volume:
        // 1. User is dragging
        // 2. Cooldown period (700ms) is active
        // 3. Difference is negligible (< 0.03)
        const isCooldown = !!volumeCooldownTimer;
        const delta = Math.abs(incomingVol - uiVolume);

        if (!isDraggingVolume && !isCooldown && delta >= 0.03) {
            uiVolume = incomingVol;
            document.getElementById('volume-slider').value = Math.round(uiVolume * 100);
            console.log(`[Renderer] Syncing UI to incoming volume: ${uiVolume} (delta: ${delta.toFixed(3)})`);
        }
    }
    logStats();
});

const volSlider = document.getElementById('volume-slider');

volSlider.onpointerdown = () => {
    isDraggingVolume = true;
};

// Global listener for robust release detection
window.addEventListener('pointerup', () => {
    if (isDraggingVolume) {
        isDraggingVolume = false;
        // Start 700ms cooldown to avoid race condition with incoming WS message
        if (volumeCooldownTimer) clearTimeout(volumeCooldownTimer);
        volumeCooldownTimer = setTimeout(() => {
            volumeCooldownTimer = null;
        }, 700);
    }
});

volSlider.oninput = (e) => {
    uiVolume = Math.round(parseFloat(e.target.value)) / 100;
    uiVolume = Math.max(0, Math.min(1, uiVolume)); // Clamp

    console.log(`[Renderer] setVolume input (UI): ${uiVolume}`);
    sendCommand('cmd', 'setVolume', { value: uiVolume });
};

// --- UI Controls ---
document.getElementById('close-btn').onclick = () => {
    console.log('[DEBUG] CLICK close');
    window.electronAPI.quitApp();
};

document.getElementById('prev-btn').onclick = () => {
    console.log('[DEBUG] CLICK prev');
    sendCommand('cmd', 'prev');
};
document.getElementById('play-pause-btn').onclick = () => {
    console.log('[DEBUG] CLICK play-pause');
    sendCommand('cmd', 'playPause');
};
document.getElementById('next-btn').onclick = () => {
    console.log('[DEBUG] CLICK next');
    sendCommand('cmd', 'next');
};

// --- Progress Bar ---
const progressBar = document.getElementById('progress-bar');

progressBar.addEventListener('pointerdown', (e) => {
    console.log(`[DEBUG] CLICK progress pointerdown at x=${e.offsetX}`);
    if (!isNaN(lastDuration) && lastDuration > 0) isSeeking = true;
});

progressBar.onmousedown = () => {
    if (!isNaN(lastDuration) && lastDuration > 0) isSeeking = true;
};

progressBar.oninput = (e) => {
    if (isNaN(lastDuration) || lastDuration <= 0) return;

    const percent = e.target.value / 100;
    document.getElementById('progress-fill').style.width = (percent * 100) + '%';
    const seekSec = percent * lastDuration;

    // Throttle seek commands
    if (!seekThrottleTimer) {
        sendCommand('cmd', 'seek', { valueSec: seekSec });
        seekThrottleTimer = setTimeout(() => {
            seekThrottleTimer = null;
        }, 100);
    }
};

// (Moved to top)

function logStats() {
    const root = document.getElementById('container').getBoundingClientRect();
    const controls = document.getElementById('bottom-bar').getBoundingClientRect();
    const progress = document.getElementById('progress-container').getBoundingClientRect();
    const main = document.getElementById('main-content').getBoundingClientRect();

    const stats = `W:${window.innerWidth} H:${window.innerHeight} | RootH:${root.height} MainH:${main.height} BottomH:${controls.height}`;
    console.log(`[Diagnostic] ${stats}`);

    if (DEBUG_UI) {
        document.getElementById('debug-info').innerText = stats;
    }
}

// (Declarations moved to top)

window.electronAPI.onStateUpdate((state) => {
    lastDuration = state.durationSec;
    if (isSeeking) return;

    const timerEl = document.getElementById('timer');
    const progressEl = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');

    if (!state.durationSec || isNaN(state.durationSec) || state.durationSec <= 0) {
        timerEl.innerText = `${formatTime(state.positionSec)} / --:--`;
        progressEl.value = 0;
        progressFill.style.width = '0%';
        progressEl.classList.add('disabled');
        console.log(`[Renderer] State received: duration unknown/NaN. Reseting bar.`);
    } else {
        timerEl.innerText = `${formatTime(state.positionSec)} / ${formatTime(state.durationSec)}`;
        const percent = (state.positionSec / state.durationSec) * 100;
        progressEl.value = percent;
        progressFill.style.width = percent + '%';
        progressEl.classList.remove('disabled');
        lastDuration = state.durationSec;
        console.log(`[Renderer] State received: ${Math.round(state.positionSec)}s / ${Math.round(state.durationSec)}s. Bar updated: ${Math.round(percent)}%`);
    }
    logStats();
});

// (Shadowing removed to fix SyntaxError)
window.addEventListener('mouseup', () => {
    isSeeking = false;
});

// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
    if (DEBUG_OVERLAY) {
        document.body.classList.add('debug-mode');
        const updateDebugStats = () => {
            const container = document.getElementById('container');
            const top = document.getElementById('top-region');
            const bottom = document.getElementById('bottom-bar');
            const main = document.getElementById('main-content');
            const progress = document.getElementById('progress-container');

            const stats = `rootH:${container.clientHeight} topH:${top.clientHeight} bottomH:${bottom.clientHeight} progressH:${progress.clientHeight} DRAG:ON`;
            let div = document.getElementById('debug-overlay-text');
            if (!div) {
                div = document.createElement('div');
                div.id = 'debug-overlay-text';
                document.body.appendChild(div);
            }
            div.innerText = stats;
        };
        updateDebugStats();
        setInterval(updateDebugStats, 1000);
    }
    logStats();
});
