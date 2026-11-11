(() => {
    const api = window.electronAPI;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    let source = 'local';
    let id = '';
    let revision = 0;
    let playbackError = '';
    let context;
    let analyser;
    const samples = new Uint8Array(128).fill(128);
    const notice = document.getElementById('folder-notice');

    function report(extra = {}) {
        if (source !== 'local' || !id) return;
        api.reportLocalAudio({ id, revision,
            positionSec: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
            durationSec: Number.isFinite(audio.duration) ? audio.duration : 0,
            playing: !audio.paused && !audio.ended,
            ...(playbackError ? { error: playbackError } : {}), ...extra });
    }

    function fail(message) {
        playbackError = message;
        audio.pause();
        notice.textContent = message;
        document.getElementById('artist').textContent = message;
        report({ playing: false, error: message });
    }

    async function play() {
        const startedRevision = revision;
        playbackError = '';
        try {
            if (!context) {
                context = new AudioContext();
                analyser = context.createAnalyser();
                analyser.fftSize = 128;
                context.createMediaElementSource(audio).connect(analyser);
                analyser.connect(context.destination);
            }
            await context.resume();
            if (source !== 'local' || revision !== startedRevision) return;
            await audio.play();
            if (source !== 'local') audio.pause();
        } catch (error) {
            if (source !== 'local' || startedRevision !== revision || error.name === 'AbortError') return;
            fail(error.name === 'NotAllowedError' ? 'Press Play to start audio.' : 'Cannot play this file. Try another track.');
        }
    }

    window.readLocalWave = () => {
        if (source !== 'local') return null;
        if (analyser && !audio.paused && context.state === 'running') analyser.getByteTimeDomainData(samples);
        else samples.fill(128);
        return samples;
    };

    api.onSourceChange((value) => {
        source = value;
        document.getElementById('like-btn').disabled = source === 'local';
        if (source !== 'local') {
            audio.pause();
            if (context) context.suspend().catch(() => {});
        }
    });
    api.onTrackUpdate((track) => {
        const image = document.getElementById('now-cover');
        const cover = track?.source === 'local' && /^ytmamp-media:\/\/art\/[a-f0-9]{64}$/.test(track.cover || '') ? track.cover : '';
        image.hidden = !cover;
        if (cover) {
            image.src = cover;
            image.alt = (track.album || 'Album') + ' cover';
        } else image.removeAttribute('src');
    });
    document.getElementById('now-cover').addEventListener('error', (event) => { event.target.hidden = true; });
    api.onLocalAudioCommand((command) => {
        if (command.action === 'load' || command.action === 'unload') {
            playbackError = '';
            audio.pause();
            revision = command.revision;
            id = command.id || '';
            if (command.action === 'unload') {
                audio.removeAttribute('src'); audio.load(); return;
            }
            audio.src = command.url;
            audio.volume = command.volume;
            audio.load();
            if (command.autoplay && source === 'local') play();
            return;
        }
        if (command.revision !== revision) return;
        if (command.action === 'pause') audio.pause();
        else if (source === 'local') {
            if (command.action === 'play') play();
            else if (command.action === 'volume') audio.volume = command.volume;
            else if (command.action === 'seek' && audio.readyState > 0) audio.currentTime = command.positionSec;
        }
    });
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'seeked', 'volumechange']) {
        audio.addEventListener(event, () => report());
    }
    audio.addEventListener('ended', () => report({ ended: true }));
    audio.addEventListener('error', () => { if (id && source === 'local') fail('File unavailable or unsupported. Reconnect the drive or choose another track.'); });
})();
