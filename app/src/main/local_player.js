const { EventEmitter } = require('node:events');

class LocalPlayer extends EventEmitter {
    constructor({ volume = 0.5, random = Math.random } = {}) {
        super();
        this.library = { root: '', name: '', tracks: [] };
        this.index = -1;
        this.revision = 0;
        this.volume = volume;
        this.random = random;
        this.shuffle = false;
        this.repeat = false;
        this.state = { positionSec: 0, durationSec: 0, playing: false };
    }
    get current() { return this.library.tracks[this.index] || null; }
    track() {
        const item = this.current;
        return item ? { title: item.title, artist: item.artist, mediaId: item.id, source: 'local', volume: this.volume } : null;
    }
    catalog() {
        return { name: this.library.name, limited: this.library.limited, skipped: this.library.skipped,
            tracks: this.library.tracks.map(({ id, title, relativePath }) => ({ id, title, relativePath })) };
    }
    publish() {
        this.emit('track', this.track());
        this.emit('state', { ...this.state });
        this.emit('selection', { id: this.current?.id || '', shuffle: this.shuffle, repeat: this.repeat });
    }
    setLibrary(library, selectedId = '') {
        this.library = library;
        this.emit('catalog', this.catalog());
        this.select(Math.max(0, library.tracks.findIndex((item) => item.id === selectedId)), false);
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
        this.state = { positionSec: 0, durationSec: 0, playing: false };
        this.publish();
        this.emit('audio', { action: 'load', id: this.current.id, revision: this.revision,
            url: `ytmamp-media://audio/${this.current.id}`, volume: this.volume, autoplay });
    }
    pause() {
        this.emit('audio', { action: 'pause', revision: this.revision });
        this.state.playing = false;
        this.emit('state', { ...this.state });
    }
    command(command) {
        const { cmd } = command;
        if (cmd === 'shuffle' || cmd === 'repeat') {
            this[cmd] = !this[cmd]; this.publish(); return true;
        }
        if (cmd === 'setVolume') {
            if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1) return false;
            this.volume = command.value;
            this.emit('audio', { action: 'volume', volume: this.volume, revision: this.revision });
            this.emit('volume', this.volume);
            return true;
        }
        if (!this.current) return false;
        if (cmd === 'next' || cmd === 'prev') {
            let next = (this.index + (cmd === 'next' ? 1 : -1) + this.library.tracks.length) % this.library.tracks.length;
            if (cmd === 'next' && this.shuffle && this.library.tracks.length > 1) {
                next = (this.index + 1 + Math.floor(this.random() * (this.library.tracks.length - 1))) % this.library.tracks.length;
            }
            this.select(next); return true;
        }
        if (cmd === 'seek') {
            if (!Number.isFinite(command.valueSec) || command.valueSec < 0) return false;
            this.emit('audio', { action: 'seek', positionSec: Math.min(command.valueSec, this.state.durationSec), revision: this.revision });
            return true;
        }
        if (cmd === 'pause') { this.pause(); return true; }
        if (cmd === 'playPause') {
            this.emit('audio', { action: this.state.playing ? 'pause' : 'play', revision: this.revision });
            return true;
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
            if (this.repeat || this.shuffle || this.index < this.library.tracks.length - 1) this.command({ cmd: 'next' });
        }
        return true;
    }
}

module.exports = { LocalPlayer };
