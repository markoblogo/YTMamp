(() => {
    const api = window.electronAPI;
    const view = window.LibraryView;
    const $ = (id) => document.getElementById(id);
    let tracks = [];
    let roots = [];
    let source = 'local';
    let selection = '';
    let albumId = '';
    let mode = 'tracks';
    let visible = false;
    let busy = false;
    let rendered = 0;
    let results = [];
    let searchTimer;

    function cover(url, className, size) {
        if (!/^ytmamp-media:\/\/art\/[a-f0-9]{64}$/.test(url || '')) return null;
        const image = document.createElement('img');
        image.src = url; image.alt = ''; image.width = size; image.height = size;
        image.className = className; image.loading = 'lazy'; image.decoding = 'async';
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        return image;
    }
    function span(text, className) {
        const node = document.createElement('span'); node.textContent = text; node.className = className; return node;
    }
    function setVisible(value) {
        visible = value;
        $('local-queue').hidden = !value;
        $('queue-toggle').setAttribute('aria-expanded', String(value));
        api.setQueueVisible(value);
        if (value) $('library-search').focus();
    }
    function updateSelection() {
        for (const button of $('queue-tracks').querySelectorAll('button')) {
            button.setAttribute('aria-current', String(button.dataset.id === selection));
            button.disabled = source !== 'local' || button.dataset.available === 'false';
        }
        $('album-play').disabled = source !== 'local' || !tracks.some((track) => track.albumId === albumId && track.available !== false);
    }
    function appendResults() {
        const fragment = document.createDocumentFragment();
        const end = Math.min(results.length, rendered + 200);
        for (; rendered < end; rendered++) {
            const result = results[rendered];
            const button = document.createElement('button');
            if (mode === 'albums') {
                button.className = 'album-card';
                const art = cover(result.cover, 'album-cover', 84) || span('ALBUM', 'album-placeholder');
                button.append(art, span(result.title, 'album-name'), span(result.artist, 'album-artist'), span(result.count + ' tracks' + (result.available ? '' : ' / offline'), 'album-count'));
                button.setAttribute('aria-label', result.title + ', ' + result.artist + ', ' + result.count + ' tracks');
                button.addEventListener('click', () => {
                    albumId = result.id; mode = 'tracks'; $('library-search').value = ''; render();
                });
                fragment.appendChild(button);
            } else {
                const item = document.createElement('li');
                const art = cover(result.cover, 'track-cover', 32);
                if (art) button.appendChild(art);
                const copy = document.createElement('span'); copy.className = 'track-copy';
                copy.append(span(result.title, 'track-title'), span([result.artist, result.album, result.available === false ? 'Offline' : ''].filter(Boolean).join(' / '), 'track-detail'));
                button.appendChild(copy);
                button.title = result.relativePath;
                button.dataset.id = result.id;
                button.dataset.available = String(result.available !== false);
                button.disabled = source !== 'local' || result.available === false;
                button.setAttribute('aria-current', String(result.id === selection));
                button.addEventListener('click', () => api.selectLocalTrack(result.id, albumId));
                item.appendChild(button); fragment.appendChild(item);
            }
        }
        (mode === 'albums' ? $('album-grid') : $('queue-tracks')).appendChild(fragment);
        $('queue-more').hidden = rendered >= results.length;
    }
    function render() {
        const filtered = view.filterTracks(tracks, { query: $('library-search').value, rootId: $('library-folder-filter').value, albumId });
        results = mode === 'albums' ? view.albums(filtered) : filtered;
        rendered = 0;
        $('queue-tracks').replaceChildren(); $('album-grid').replaceChildren();
        $('queue-tracks').hidden = mode !== 'tracks'; $('album-grid').hidden = mode !== 'albums';
        $('view-tracks').setAttribute('aria-pressed', String(mode === 'tracks'));
        $('view-albums').setAttribute('aria-pressed', String(mode === 'albums'));
        $('library-count').textContent = filtered.length + ' / ' + tracks.length + ' tracks';
        $('library-empty').hidden = results.length > 0;
        $('library-empty').textContent = tracks.length ? 'No music matches this search.' : 'Add your music folders to build the library.';
        const selectedAlbum = view.albums(tracks).find((album) => album.id === albumId);
        $('album-detail').hidden = !selectedAlbum;
        $('album-title').textContent = selectedAlbum ? selectedAlbum.title + ' / ' + selectedAlbum.artist : '';
        appendResults(); updateSelection();
        $('library-results').scrollTop = 0;
    }
    function renderRoots() {
        const selectedRoot = $('library-folder-filter').value;
        $('library-folder-filter').replaceChildren(new Option('All folders', ''));
        $('library-roots').replaceChildren();
        for (const root of roots) {
            const label = root.label || root.name;
            $('library-folder-filter').appendChild(new Option(label + (root.status === 'offline' ? ' (offline)' : ''), root.id));
            const row = document.createElement('div'); row.className = 'library-root' + (root.status === 'offline' ? ' offline' : '');
            row.appendChild(span(label + ' (' + root.count + ')' + (root.status === 'offline' ? ' / offline' : ''), 'root-name'));
            const remove = document.createElement('button'); remove.textContent = 'X'; remove.disabled = busy;
            remove.setAttribute('aria-label', 'Remove ' + label + ' from library');
            remove.title = 'Remove folder from library. Original files stay in place.';
            remove.addEventListener('click', () => api.removeLibraryFolder(root.id));
            row.appendChild(remove); $('library-roots').appendChild(row);
        }
        $('library-folder-filter').value = roots.some((root) => root.id === selectedRoot) ? selectedRoot : '';
    }
    $('source-select').addEventListener('change', (event) => api.setSource(event.target.value));
    $('open-folder').addEventListener('click', () => { setVisible(true); api.openMusicFolder(); });
    $('queue-toggle').addEventListener('click', () => setVisible(!visible));
    $('library-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
    $('library-clear').addEventListener('click', () => { $('library-search').value = ''; render(); $('library-search').focus(); });
    $('library-folder-filter').addEventListener('change', () => { albumId = ''; render(); });
    $('view-tracks').addEventListener('click', () => { mode = 'tracks'; render(); });
    $('view-albums').addEventListener('click', () => { mode = 'albums'; albumId = ''; render(); });
    $('album-back').addEventListener('click', () => { albumId = ''; mode = 'albums'; render(); });
    $('album-play').addEventListener('click', () => api.playLocalAlbum(albumId));
    $('library-refresh').addEventListener('click', () => api.refreshLibrary());
    $('queue-more').addEventListener('click', appendResults);
    $('cancel-scan').addEventListener('click', () => api.cancelFolderScan());
    api.onSourceChange((value) => { source = value; $('source-select').value = value; updateSelection(); });
    api.onLocalCatalog((catalog) => {
        tracks = catalog.tracks; roots = catalog.roots || [];
        if (albumId && !tracks.some((track) => track.albumId === albumId)) albumId = '';
        renderRoots(); render();
    });
    api.onLocalSelection((value) => {
        selection = value.id;
        $('shuffle-btn').setAttribute('aria-pressed', String(value.shuffle));
        $('repeat-btn').setAttribute('aria-pressed', String(value.repeat));
        updateSelection();
    });
    api.onFolderNotice(({ message, busy: value }) => {
        busy = value; $('folder-notice').textContent = message;
        $('cancel-scan').hidden = !busy; $('open-folder').disabled = busy; $('library-refresh').disabled = busy;
        for (const button of $('library-roots').querySelectorAll('button')) button.disabled = busy;
    });
})();
