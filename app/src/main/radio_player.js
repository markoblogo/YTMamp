const { EventEmitter } = require('node:events');
class RadioPlayer extends EventEmitter {
    constructor({ library, volume = 0.5 }) {
        super(); this.library = library; this.volume = volume; this.id = ''; this.revision = 0; this.attempts = 0; this.wanted = false; this.timer = null; this.tried = new Set(); this.tunedFrequency = 87.5;
        this.state = { positionSec: 0, durationSec: 0, playing: false };
    }
    get current() { return this.library.stations.get(this.id); }
    track() { return this.current ? { title: this.current.name, artist: [this.current.region, this.current.countrycode, this.current.genre].filter(Boolean).join(' / ').slice(0, 300), source: 'radio', mediaId: this.id, durationSec: 0, volume: this.volume } : null; }
    publish() {
        this.emit('track', this.track()); this.emit('state', { ...this.state });
        this.emit('selection', { id: this.id, local: this.library.local(), location: this.library.location, favorite: this.library.favorites.has(this.id) });
    }
    select(id, { tuning = false } = {}) {
        if (!this.library.stations.has(id)) return false;
        const candidate = this.library.stations.get(id);
        if (!this.library.usable(candidate)) { const alternate = this.library.alternatives(id)[0]; if (!alternate) return false; id = alternate.id; }
        this.tried = new Set([id]);
        const fromFrequency = this.tunedFrequency;
        const frequency = this.library.local().find((station) => station.id === id)?.frequency;
        if (frequency) this.tunedFrequency = frequency;
        this.pause(); this.id = id; this.library.activeId = id; this.attempts = 0; this.wanted = true; this.load(tuning ? { fromFrequency, frequency } : false); return true;
    }
    load(tuning = false) {
        clearTimeout(this.timer); this.revision++;
        this.state = { positionSec: 0, durationSec: 0, playing: false, connecting: true };
        this.publish(); this.emit('audio', { action: 'load', id: this.id, revision: this.revision, url: 'ytmamp-media://radio/' + this.id, volume: this.volume, tuning: !!tuning,
            ...(tuning ? { fromFrequency: tuning.fromFrequency, frequency: tuning.frequency } : {}) });
    }
    pause() {
        clearTimeout(this.timer); this.timer = null; this.wanted = false; this.revision++;
        this.emit('audio', { action: 'pause', revision: this.revision });
        this.state = { positionSec: 0, durationSec: 0, playing: false }; this.publish();
    }
    command({ cmd, value }) {
        if (cmd === 'pause') { this.pause(); return true; }
        if (cmd === 'setVolume') { if (!Number.isFinite(value) || value < 0 || value > 1) return false; this.volume = value; this.emit('audio', { action: 'volume', volume: value, revision: this.revision }); this.emit('volume', value); return true; }
        if (cmd === 'next' || cmd === 'prev') {
            const queue = this.library.local(); if (!queue.length) return false;
            const index = queue.findIndex((s) => s.id === this.id);
            let next;
            if (index >= 0) next = (index + (cmd === 'next' ? 1 : -1) + queue.length) % queue.length;
            else if (cmd === 'next') { next = queue.findIndex((s) => s.frequency > this.tunedFrequency); if (next < 0) next = 0; }
            else { next = queue.findLastIndex((s) => s.frequency < this.tunedFrequency); if (next < 0) next = queue.length - 1; }
            return this.select(queue[next].id, { tuning: true });
        }
        if (!this.current) return false;
        if (cmd === 'like') { this.library.toggleFavorite(this.id); this.publish(); return true; }
        if (cmd === 'playPause') { if (this.wanted) this.pause(); else { this.wanted = true; this.attempts = 0; this.load(); } return true; }
        return false; // Live radio has no seek, shuffle or repeat.
    }
    receive(report) {
        if (!report || report.id !== this.id || report.revision !== this.revision || !this.wanted || typeof report.playing !== 'boolean') return false;
        this.state = { positionSec: 0, durationSec: 0, playing: report.playing, connecting: report.connecting === true };
        if (report.playing) { clearTimeout(this.timer); this.timer = null; this.library.markSuccessful(this.id); }
        if (report.error) {
            if (this.timer) return false;
            if (!report.offline) this.library.markFailed(this.id);
            this.state.error = this.current?.hls ? 'This HLS stream is not supported. Choose another stream for this station.' : 'Station unavailable. Try another stream or Retry.';
            if (this.attempts < 3) { this.state.connecting = true; const revision = this.revision; this.timer = setTimeout(() => {
                this.timer = null;
                if (!this.wanted || this.revision !== revision) return;
                const alternate = this.library.alternatives(this.id).find((s) => !this.tried.has(s.id));
                if (alternate) { this.id = alternate.id; this.library.activeId = this.id; this.tried.add(this.id); }
                this.load();
            }, 1000 * 2 ** this.attempts++); this.timer.unref?.(); }
            else this.wanted = false;
        }
        this.emit('state', { ...this.state }); return true;
    }
    close() { this.pause(); }
}
module.exports = { RadioPlayer };
