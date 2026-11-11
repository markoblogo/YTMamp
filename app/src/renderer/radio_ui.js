(() => {
    const api = window.electronAPI; const $ = (id) => document.getElementById(id);
    let source = 'local'; let view = 'all'; let selected = ''; let local = []; let saved = []; let rows = []; let location; let offset = 0; let serial = 0; let busy = false; let pendingFrequency; let locating = false; let loaded = false;
    const notice = (message) => { $('radio-notice').textContent = message; };
    const call = async (action, data) => { const result = await api.radio(action, data); if (result?.error) throw new Error(result.error); return result; };
    function updateDial() {
        const item = local.find((s) => s.id === selected);
        $('radio-dial').disabled = !local.length;
        $('prev-btn').disabled = false;
        $('next-btn').disabled = false;
        $('radio-frequency').textContent = item ? item.frequency.toFixed(1) + ' MHz / ' + (location?.label || 'LOCAL') : selected ? 'ONLINE / LIVE' : locating ? 'Finding local FM…' : location ? 'No local FM data / use LIBRARY' : 'LIBRARY: choose an online station';
        if (item) $('radio-dial').value = item.frequency;
        const dial = $('radio-dial'); dial.setAttribute('aria-valuetext', item ? item.name + ', ' + item.frequency + ' MHz' : 'Local FM stations');
    }
    function span(text, className) { const element = document.createElement('span'); element.textContent = text; element.className = className; return element; }
    function render() {
        const fragment = document.createDocumentFragment();
        for (const station of rows) {
            const card = document.createElement('div'); card.className = 'radio-card';
            const play = document.createElement('button'); play.className = 'album-card'; play.dataset.id = station.id;
            play.setAttribute('aria-current', String(station.id === selected));
            if (/^ytmamp-media:\/\/radio-art\/[a-f0-9]{64}$/.test(station.cover || '')) {
                const image = document.createElement('img'); image.src = station.cover; image.alt = ''; image.width = 84; image.height = 84; image.loading = 'lazy'; image.decoding = 'async';
                image.addEventListener('error', () => image.replaceWith(span('RADIO', 'album-placeholder')), { once: true }); play.append(image);
            } else play.append(span('RADIO', 'album-placeholder'));
            play.append(span(station.name, 'album-name'), span([station.countrycode, station.region, station.language].filter(Boolean).join(' / '), 'album-artist'), span(station.genre || station.codec || 'Online radio', 'album-count'));
            if (view === 'local') play.append(span(station.frequency + ' MHz', 'radio-mhz'));
            play.title = [station.name, station.genre, station.language, station.region].join('\n');
            play.addEventListener('click', () => call('play', { id: station.id }).catch((e) => notice(e.message)));
            const favorite = document.createElement('button'); favorite.textContent = station.favorite ? 'Saved' : 'Favorite'; favorite.setAttribute('aria-pressed', String(station.favorite)); favorite.setAttribute('aria-label', 'Favorite ' + station.name);
            favorite.addEventListener('click', () => call('favorite', { id: station.id }).then(() => { station.favorite = !station.favorite; render(); }).catch((e) => notice(e.message)));
            const fm = document.createElement('button'); fm.textContent = 'Set local FM'; fm.disabled = !location;
            fm.addEventListener('click', () => {
                if (pendingFrequency) pendingFrequency.remove();
                const form = document.createElement('form'); form.className = 'frequency-form';
                const input = document.createElement('input'); input.type = 'number'; input.min = '87.5'; input.max = '108'; input.step = '0.1'; input.required = true; input.placeholder = 'Actual MHz'; input.setAttribute('aria-label', station.name + ' local frequency');
                const submit = document.createElement('button'); submit.textContent = 'Save MHz'; form.append(input, submit); card.append(form); input.focus(); pendingFrequency = form;
                form.addEventListener('submit', (event) => { event.preventDefault(); call('frequency', { id: station.id, value: input.value }).then(refreshSnapshot).then(() => { form.remove(); notice('Local frequency saved for this location.'); }).catch((e) => notice(e.message)); });
            });
            const actions = document.createElement('div'); actions.className = 'radio-card-actions'; actions.append(favorite, fm); card.append(play, actions); fragment.append(card);
        }
        $('radio-grid').replaceChildren(fragment);
        for (const kind of ['all', 'favorites', 'local']) $('radio-' + kind).setAttribute('aria-pressed', String(view === kind));
    }
    function query() { return { name: $('radio-search').value, genre: $('radio-genre').value, language: $('radio-language').value, sort: $('radio-sort').value, order: ({ genre: 'tags', region: 'state' })[$('radio-sort').value] || $('radio-sort').value, view, offset }; }
    async function search(more = false) {
        const ticket = ++serial;
        if (!more) offset = 0;
        busy = true; $('radio-more').disabled = true; notice('Searching stations…');
        try {
            if (view === 'local') { rows = local; $('radio-more').hidden = true; render(); notice(local.length ? local.length + ' local stations, ordered by supplied FM frequency.' : locating ? 'Finding local stations from your device location…' : 'No supplied FM frequencies nearby. All stations is available without local FM data.'); return; }
            const result = await call('search', query());
            if (ticket !== serial) return;
            rows = more ? [...new Map([...rows, ...result.stations].map((s) => [s.id, s])).values()] : result.stations;
            $('radio-more').hidden = !result.more || offset >= 1000;
            loaded = true;
            render(); notice(result.warning || rows.length + ' stations' + (result.cached ? ' / saved results' : ' / Radio Browser') + (rows.length ? '' : '. Try a broader search.'));
        } catch (error) { if (ticket === serial) notice(error.message); }
        finally { if (ticket === serial) { busy = false; $('radio-more').disabled = false; } }
    }
    function snapshot(data) { local = data.local || []; saved = data.stations || []; location = data.location; $('radio-location-label').textContent = location?.label || 'Location not set'; updateDial(); if (view === 'local') { rows = local; render(); } }
    async function refreshSnapshot() { snapshot(await call('snapshot')); }
    $('radio-search-form').addEventListener('submit', (event) => { event.preventDefault(); search(); });
    $('radio-sort').addEventListener('change', () => search());
    for (const id of ['radio-genre', 'radio-language']) $(id).addEventListener('change', () => search());
    $('radio-more').addEventListener('click', () => { if (!busy) { offset += 200; search(true); } });
    for (const kind of ['all', 'favorites', 'local']) $('radio-' + kind).addEventListener('click', () => { view = kind; search(); });
    $('radio-collapse').addEventListener('click', () => window.setLibraryVisible(false));
    $('radio-retry').addEventListener('click', () => call('play', { id: selected, retry: true }).catch((e) => notice(e.message)));
    async function locateDevice() {
        if (locating) return;
        locating = true; $('radio-locate').disabled = true; $('radio-location-label').textContent = 'Allow device location for local FM. Online stations remain available.'; updateDial();
        try {
            let data = await call('device-location');
            if (data.browser) {
                const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Device location is unavailable or denied. Online stations still work.')), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }));
                data = await call('location', { lat: position.coords.latitude, lon: position.coords.longitude, label: 'Device location' });
            }
            snapshot(data);
            $('radio-location-label').textContent = (location?.label || 'Device location') + ': ' + local.length + ' supplied local FM stations.';
        } catch (e) { $('radio-location-label').textContent = e.message; }
        finally { locating = false; $('radio-locate').disabled = false; updateDial(); if (view === 'local') search(); }
    }
    $('radio-locate').addEventListener('click', locateDevice);
    window.ensureRadioStation = () => {
        if (source !== 'radio' || selected) return true;
        if (local[0]) call('play', { id: local[0].id }).catch((e) => notice(e.message));
        else { window.setLibraryVisible(true); notice('Choose a station card to start listening. Location is optional for the online catalog.'); }
        return false;
    };
    window.ensureLocalRadioQueue = () => {
        if (source !== 'radio' || local.length) return true;
        view = 'local'; window.setLibraryVisible(true); search();
        if (!location && !locating) locateDevice();
        return false;
    };
    $('radio-custom-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await call('custom', { name: $('radio-custom-name').value, url: $('radio-custom-url').value }); await refreshSnapshot(); view = 'favorites'; search(); } catch (e) { notice(e.message); } });
    $('radio-dial').addEventListener('input', () => { $('radio-frequency').textContent = Number($('radio-dial').value).toFixed(1) + ' MHz / TUNING'; });
    $('radio-dial').addEventListener('change', () => {
        const frequency = Number($('radio-dial').value);
        const station = [...local].sort((a, b) => Math.abs(a.frequency - frequency) - Math.abs(b.frequency - frequency))[0];
        if (station) call('tune', { id: station.id }).catch((e) => notice(e.message));
    });
    $('radio-record').addEventListener('click', () => { if (!window.canRecordRadio()) { notice('Start a supported radio stream before recording.'); return; } call('record', { action: 'start' }).catch((e) => notice(e.message)); });
    $('radio-record-pause').addEventListener('click', () => call('record', { action: 'pause' }).catch((e) => notice(e.message)));
    $('radio-record-stop').addEventListener('click', () => call('record', { action: 'stop' }).catch((e) => notice(e.message)));
    $('radio-save').addEventListener('click', () => call('record', { action: 'save' }).catch((e) => notice(e.message)));
    $('radio-discard').addEventListener('click', () => call('record', { action: 'discard' }).catch((e) => notice(e.message)));
    api.onRadioRecording((state) => {
        $('radio-record').disabled = state.active || state.pending;
        $('radio-record').classList.toggle('recording', state.active && !state.paused);
        $('radio-record-pause').disabled = !state.active; $('radio-record-stop').disabled = !state.active;
        $('radio-record-pause').textContent = state.paused ? 'REC' : 'II';
        $('radio-record-pause').setAttribute('aria-label', state.paused ? 'Resume radio recording' : 'Pause radio recording');
        $('radio-record-status').textContent = state.active ? (state.paused ? 'REC PAUSED ' : 'REC ') + Math.floor(state.seconds) + 's' : state.message;
        $('radio-pending').hidden = !state.pending;
        if (state.message) notice(state.message);
    });
    api.onRadioSelection((data) => { selected = data.id; local = data.local || []; location = data.location; if (source === 'radio') { updateDial(); $('like-btn').setAttribute('aria-pressed', String(data.favorite)); for (const button of $('radio-grid').querySelectorAll('[data-id]')) button.setAttribute('aria-current', String(button.dataset.id === selected)); } });
    api.onSourceChange((value) => {
        source = value; document.body.classList.toggle('radio-mode', value === 'radio');
        $('radio-tuner').hidden = value !== 'radio'; $('progress-container').hidden = value === 'radio'; $('timer-container').hidden = value === 'radio';
        $('shuffle-btn').hidden = value === 'radio'; $('repeat-btn').hidden = value === 'radio'; $('radio-record-controls').hidden = value !== 'radio';
        $('prev-btn').title = value === 'radio' ? 'Previous local FM station' : 'Previous track'; $('next-btn').title = value === 'radio' ? 'Next local FM station' : 'Next track';
        if (value === 'radio') { refreshSnapshot().then(() => { if (!rows.length) { rows = saved; render(); } if (!loaded) search(); locateDevice(); }).catch((e) => notice(e.message)); updateDial(); }
        else { $('prev-btn').disabled = false; $('next-btn').disabled = false; }
    });
    api.onStateUpdate((state) => {
        if (source !== 'radio') return;
        if (state.playing) notice('LIVE / ' + $('title').textContent + (state.connecting ? ' / buffering…' : ''));
        else if (state.connecting) notice('Connecting to ' + $('title').textContent + '…');
        else if (state.error) notice(state.error);
        else if (selected) notice('Radio paused. Press Play to reconnect to the live stream.');
    });
})();
