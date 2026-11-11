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
    let catalog = [];
    let selection = '';
    let rendered = 0;
    let queueVisible = false;
    const samples = new Uint8Array(128).fill(128);
    const queue = document.getElementById('local-queue');
    const list = document.getElementById('queue-tracks');
    const more = document.getElementById('queue-more');
    const notice = document.getElementById('folder-notice');
    const cancel = document.getElementById('cancel-scan');

    function showQueue(visible) {
        queueVisible = visible;
        queue.hidden = !visible;
        document.getElementById('queue-toggle').setAttribute('aria-expanded', String(visible));
        api.setQueueVisible(visible);
    }

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

    function appendTracks() {
        const fragment = document.createDocumentFragment();
        const end = Math.min(catalog.length, rendered + 200);
        for (; rendered < end; rendered++) {
            const track = catalog[rendered];
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.textContent = track.title;
            button.title = track.relativePath;
            button.dataset.id = track.id;
            button.disabled = source !== 'local';
            button.setAttribute('aria-current', String(track.id === selection));
            button.addEventListener('click', () => api.selectLocalTrack(track.id));
            item.appendChild(button);
            fragment.appendChild(item);
        }
        list.appendChild(fragment);
        more.hidden = rendered >= catalog.length;
    }

    document.getElementById('source-select').addEventListener('change', (event) => api.setSource(event.target.value));
    document.getElementById('open-folder').addEventListener('click', () => { showQueue(true); api.openMusicFolder(); });
    document.getElementById('queue-toggle').addEventListener('click', () => showQueue(!queueVisible));
    more.addEventListener('click', appendTracks);
    cancel.addEventListener('click', () => api.cancelFolderScan());

    api.onSourceChange((value) => {
        source = value;
        document.getElementById('source-select').value = source;
        document.getElementById('like-btn').disabled = source === 'local';
        if (source !== 'local') {
            audio.pause();
            if (context) context.suspend().catch(() => {});
        }
        for (const button of list.querySelectorAll('button')) button.disabled = source !== 'local';
    });
    api.onLocalCatalog((value) => {
        catalog = value.tracks;
        rendered = 0;
        list.replaceChildren();
        appendTracks();
        if (value.name) notice.textContent = `${catalog.length} tracks in ${value.name}`;
    });
    api.onLocalSelection((value) => {
        selection = value.id;
        for (const button of list.querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.id === selection));
        document.getElementById('shuffle-btn').setAttribute('aria-pressed', String(value.shuffle));
        document.getElementById('repeat-btn').setAttribute('aria-pressed', String(value.repeat));
    });
    api.onFolderNotice(({ message, busy }) => {
        notice.textContent = message;
        cancel.hidden = !busy;
        document.getElementById('open-folder').disabled = busy;
        if (!catalog.length || busy) document.getElementById('artist').textContent = message;
    });
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
