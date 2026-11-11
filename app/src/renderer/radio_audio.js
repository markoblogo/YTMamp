(() => {
    const api = window.electronAPI;
    const audio = new Audio(); audio.preload = 'none'; audio.crossOrigin = 'anonymous';
    let source = 'local'; let id = ''; let revision = 0; let context; let analyser; let gain; let capture;
    let volume = 0.5; let stallTimer; let loadTimer; let noise; let ready;
    const samples = new Uint8Array(128);
    const report = (data) => { if (source === 'radio' && id) api.reportRadioAudio({ id, revision, playing: !audio.paused, ...data }); };
    async function initialize() {
        if (ready) return ready;
        ready = (async () => {
            context = new AudioContext({ sampleRate: 48000 }); analyser = context.createAnalyser(); analyser.fftSize = 128;
            const input = context.createMediaElementSource(audio);
            gain = context.createGain(); gain.gain.value = volume;
            input.connect(analyser); analyser.connect(gain); gain.connect(context.destination);
            try {
                await context.audioWorklet.addModule('radio_capture.js');
                capture = new AudioWorkletNode(context, 'radio-capture');
                const silence = context.createGain(); silence.gain.value = 0;
                input.connect(capture); capture.connect(silence); silence.connect(context.destination);
                capture.port.onmessage = ({ data }) => api.recordRadioChunk(data);
            } catch { /* Playback remains available if recording initialization fails. */ }
        })();
        return ready;
    }
    function stopNoise() { if (noise) { try { noise.stop(); } catch { /* already stopped */ } noise = null; } }
    function tuningNoise() {
        stopNoise(); if (!context || context.state !== 'running') return;
        const buffer = context.createBuffer(1, Math.round(context.sampleRate * 0.25), context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() > 0.998 ? 0.7 : 0.16) * (1 - i / data.length);
        noise = context.createBufferSource(); noise.buffer = buffer;
        const level = context.createGain(); level.gain.value = volume * 0.2;
        noise.connect(level); level.connect(context.destination); noise.start(); noise.stop(context.currentTime + 0.25);
    }
    function stop() { clearTimeout(stallTimer); clearTimeout(loadTimer); audio.pause(); audio.removeAttribute('src'); audio.load(); stopNoise(); }
    api.onSourceChange((value) => { source = value; if (value !== 'radio') { stop(); capture?.port.postMessage(false); context?.suspend().catch(() => {}); } });
    api.onRadioAudioCommand(async (command) => {
        if (command.action === 'pause') { revision = command.revision; stop(); return; }
        if (command.action === 'volume') { volume = command.volume; if (gain) gain.gain.value = volume; return; }
        if (command.action !== 'load' || source !== 'radio') return;
        stop(); id = command.id; revision = command.revision; volume = command.volume;
        const started = revision;
        try {
            await initialize(); await context.resume();
            if (source !== 'radio' || revision !== started) return;
            gain.gain.value = volume;
            if (command.tuning && document.getElementById('radio-noise').checked) tuningNoise();
            audio.src = command.url;
            loadTimer = setTimeout(() => { if (revision === started) { audio.pause(); report({ playing: false, error: true }); } }, 16000);
            await audio.play();
            if (revision !== started || source !== 'radio') { if (source !== 'radio') audio.pause(); return; }
            clearTimeout(loadTimer); report({ playing: true, connecting: false });
        } catch (error) { if (source === 'radio' && revision === started && error.name !== 'AbortError') report({ playing: false, error: true }); }
    });
    audio.addEventListener('playing', () => { clearTimeout(stallTimer); clearTimeout(loadTimer); report({ playing: true, connecting: false }); });
    const stall = () => { clearTimeout(stallTimer); report({ connecting: true }); stallTimer = setTimeout(() => report({ playing: false, error: true }), 12000); };
    audio.addEventListener('waiting', stall); audio.addEventListener('stalled', stall);
    audio.addEventListener('error', () => { if (audio.getAttribute('src')) report({ playing: false, error: true }); });
    audio.addEventListener('ended', () => report({ playing: false, error: true }));
    window.readRadioWave = () => {
        if (source !== 'radio') return null;
        if (analyser && !audio.paused && context.state === 'running') analyser.getByteTimeDomainData(samples); else samples.fill(128);
        return samples;
    };
    api.onRadioRecording((state) => capture?.port.postMessage(state.active && !state.paused && source === 'radio'));
    window.canRecordRadio = () => !!capture;
})();
