(function (root) {
    const normalize = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    function filterTracks(tracks, { query = '', rootId = '', albumId = '' } = {}) {
        const terms = normalize(query.slice(0, 200)).split(/\s+/).filter(Boolean);
        return tracks.filter((track) => {
            if (rootId && track.rootId !== rootId && !track.rootIds?.includes(rootId)) return false;
            if (albumId && track.albumId !== albumId) return false;
            if (!terms.length) return true;
            const text = normalize([track.title, track.artist, track.album, track.albumArtist, track.genre, track.year, track.relativePath, track.rootName].join(' '));
            return terms.every((term) => text.includes(term));
        });
    }
    function albums(tracks) {
        const groups = new Map();
        for (const track of tracks) {
            const id = track.albumId || track.id;
            const artist = track.albumArtist || track.artist || 'Unknown artist';
            if (!groups.has(id)) groups.set(id, { id, title: track.album || 'Unknown album', artist, year: track.year || 0, cover: '', count: 0, available: 0 });
            const album = groups.get(id);
            if (album.artist !== artist) album.artist = 'Various artists';
            album.count++;
            if (track.available !== false) album.available++;
            if (!album.cover && track.cover) album.cover = track.cover;
        }
        return [...groups.values()].sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    }
    const api = { normalize, filterTracks, albums };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LibraryView = api;
})(typeof window === 'object' ? window : {});
