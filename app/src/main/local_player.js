const { EventEmitter } = require('node:events');

class LocalPlayer extends EventEmitter {
    constructor({ volume = 0.5, random = Math.random } = {}) {
        super();
        this.library = { root: '', name: '', roots: [], tracks: [] };
        this.index = -1;
        this.revision = 0;
        this.volume = volume;
        this.random = random;
        this.shuffle = false;
        this.repeat = false;
        this.queueIds = [];
        this.queueAlbumId = '';
        this.state = { positionSec: 0, durationSec: 0, playing: false };
    }
    get current() { return this.library.tracks[this.index] || null; }
    track() {
        const item = this.current;
        return item ? { title: item.title, artist: item.artist, album: item.album || '', albumArtist: item.albumArtist || '',
            cover: item.cover || '', mediaId: item.id, durationSec: item.durationSec || 0, source: 'local', volume: this.volume } : null;
    }
    catalog() {
        return { name: this.library.name, limited: this.library.limited, skipped: this.library.skipped, roots: this.library.roots || [],
            tracks: this.library.tracks.map(({ id, title, artist, album, albumArtist, albumId, genre, year, trackNo, discNo, durationSec, cover, rootId, rootIds, rootName, available, relativePath }) =>
                ({ id, title, artist, album, albumArtist, albumId, genre, year, trackNo, discNo, durationSec, cover, rootId, rootIds, rootName, available: available !== false, relativePath })) };
    }
    publish() {
        this.emit('track', this.track());
        this.emit('state', { ...this.state });
        this.emit('selection', { id: this.current?.id || '', shuffle: this.shuffle, repeat: this.repeat, queueAlbumId: this.queueAlbumId });
    }
    setLibrary(library, selectedId = '', { preservePlayback = false } = {}) {
        const oldId = this.current?.id;
        this.library = library;
        this.queueIds = library.tracks.filter((track) => !this.queueAlbumId || track.albumId === this.queueAlbumId).map((track) => track.id);
        if (!this.queueIds.length) { this.queueAlbumId = ''; this.queueIds = library.tracks.map((track) => track.id); }
        this.emit('catalog', this.catalog());
        const keptIndex = library.tracks.findIndex((item) => item.id === oldId);
        if (preservePlayback && keptIndex >= 0 && library.tracks[keptIndex].available !== false) {
            this.index = keptIndex;
            this.publish(); // Keep the media element and revision while indexing.
            return;
        }
        const restoredId = preservePlayback && oldId ? oldId : selectedId;
        const restored = library.tracks.findIndex((item) => item.id === restoredId);
        const firstAvailable = library.tracks.findIndex((item) => item.available !== false);
        this.select(restored >= 0 ? restored : Math.max(0, firstAvailable), false);
    }
    select(index, autoplay = true) {
        if (!Number.isInteger(index) || index < 0 || index >= this.library.tracks.length) {
            this.index = -1;
            this.revision++;
            this.state = { positionSec: 0, durationSec: 0, playing: false };
            this.emit('audio', { action: 'unload', revision: this.revision });
            this.publish();
            return;
        }
        this.index = index;
        this.revision++;
        this.state = { positionSec: 0, durationSec: this.current.durationSec || 0, playing: false };
        if (this.current.available === false) {
            this.state.error = 'This folder is offline. Reconnect the drive and refresh the library.';
            this.emit('audio', { action: 'unload', revision: this.revision });
            this.publish(); return;
        }
        this.publish();
        this.emit('audio', { action: 'load', id: this.current.id, revision: this.revision,
            url: 'ytmamp-media://audio/' + this.current.id, volume: this.volume, autoplay });
    }
    playTrack(id, albumId = '') {
        const index = this.library.tracks.findIndex((track) => track.id === id && track.available !== false);
        if (index < 0) return false;
        this.queueAlbumId = albumId && this.library.tracks[index].albumId === albumId ? albumId : '';
        this.queueIds = this.library.tracks.filter((track) => !this.queueAlbumId || track.albumId === this.queueAlbumId).map((track) => track.id);
        this.select(index);
        return true;
    }
    playAlbum(albumId) {
        const first = this.library.tracks.find((track) => track.albumId === albumId && track.available !== false);
        return first ? this.playTrack(first.id, albumId) : false;
    }
    availableQueue() {
        const online = new Set(this.library.tracks.filter((track) => track.available !== false).map((track) => track.id));
        return this.queueIds.filter((id) => online.has(id));
    }
    pause() {
        this.emit('audio', { action: 'pause', revision: this.revision });
        this.state.playing = false;
        this.emit('state', { ...this.state });
    }
    command(command) {
        const { cmd } = command;
        if (cmd === 'shuffle' || cmd === 'repeat') { this[cmd] = !this[cmd]; this.publish(); return true; }
        if (cmd === 'setVolume') {
            if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1) return false;
            this.volume = command.value;
            this.emit('audio', { action: 'volume', volume: this.volume, revision: this.revision });
            this.emit('volume', this.volume);
            return true;
        }
        if (!this.current) return false;
        if (cmd === 'next' || cmd === 'prev') {
            const queue = this.availableQueue();
            if (!queue.length) return false;
            const position = queue.indexOf(this.current.id);
            let next = (position + (cmd === 'next' ? 1 : -1) + queue.length) % queue.length;
            if (cmd === 'next' && this.shuffle && queue.length > 1 && position >= 0) {
                next = (position + 1 + Math.floor(this.random() * (queue.length - 1))) % queue.length;
            }
            this.select(this.library.tracks.findIndex((item) => item.id === queue[next])); return true;
        }
        if (this.current.available === false) return false;
        if (cmd === 'seek') {
            if (!Number.isFinite(command.valueSec) || command.valueSec < 0) return false;
            this.emit('audio', { action: 'seek', positionSec: Math.min(command.valueSec, this.state.durationSec), revision: this.revision });
            return true;
        }
        if (cmd === 'pause') { this.pause(); return true; }
        if (cmd === 'playPause') {
            this.emit('audio', { action: this.state.playing ? 'pause' : 'play', revision: this.revision }); return true;
        }
        return false;
    }
    receive(report) {
        if (!report || !this.current || report.revision !== this.revision || report.id !== this.current.id ||
            !Number.isFinite(report.positionSec) || report.positionSec < 0 ||
            !Number.isFinite(report.durationSec) || report.durationSec < 0 || typeof report.playing !== 'boolean') return false;
        this.state = { positionSec: report.positionSec, durationSec: report.durationSec, playing: report.playing };
        if (typeof report.error === 'string' && report.error) this.state.error = report.error.slice(0, 160);
        this.emit('state', { ...this.state });
        if (report.ended === true) {
            const queue = this.availableQueue();
            if (this.repeat || this.shuffle || queue.indexOf(this.current.id) < queue.length - 1) this.command({ cmd: 'next' });
        }
        return true;
    }
}

module.exports = { LocalPlayer };
