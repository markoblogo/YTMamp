const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const RATE = 48000;
const CHANNELS = 2;
const MAX_BYTES = 512 * 1024 * 1024;
const RESERVE_BYTES = 256 * 1024 * 1024;
function wavHeader(bytes) {
    const header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(bytes + 36, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * CHANNELS * 2, 28);
    header.writeUInt16LE(CHANNELS * 2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(bytes, 40); return header;
}
class RadioRecorder extends EventEmitter {
    constructor({ directory }) {
        super(); this.directory = directory; this.marker = path.join(directory, 'radio-recording-pending.json');
        this.pending = null; this.recording = null; this.bytes = 0; this.paused = false; this.startedAt = 0; this.lastDiskCheck = 0;
        try {
            if (fs.statSync(this.marker).size > 4096) return;
            const saved = JSON.parse(fs.readFileSync(this.marker, 'utf8'));
            if (!/^radio-recording-[a-f0-9]{24}\.wav$/.test(saved.file)) return;
            const file = path.join(directory, saved.file); const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 44 || stat.size > MAX_BYTES + 44) return;
            const fd = fs.openSync(file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0));
            try {
                const header = Buffer.alloc(44); fs.readSync(fd, header, 0, 44, 0);
                if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 16) !== 'WAVEfmt ' || header.readUInt32LE(24) !== RATE || header.readUInt16LE(22) !== CHANNELS) return;
                this.bytes = Math.floor((stat.size - 44) / 4) * 4;
                fs.ftruncateSync(fd, this.bytes + 44); fs.writeSync(fd, wavHeader(this.bytes), 0, 44, 0);
                this.pending = { file, name: String(saved.name || 'Recovered radio').slice(0, 80), bytes: this.bytes };
            } finally { fs.closeSync(fd); }
        } catch { /* no recoverable prior recording */ }
    }
    status(message = '') { return { active: !!this.recording, paused: this.paused, seconds: this.bytes / (RATE * CHANNELS * 2), pending: !!this.pending, message }; }
    publish(message = '') { this.emit('status', this.status(message)); }
    start(name) {
        if (this.recording || this.pending) throw new Error('Save or discard the previous recording first.');
        this.checkDisk();
        const file = path.join(this.directory, 'radio-recording-' + crypto.randomBytes(12).toString('hex') + '.wav');
        const fd = fs.openSync(file, 'wx', 0o600);
        fs.writeSync(fd, wavHeader(0));
        this.recording = { file, fd, name: String(name || 'Radio').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 80) || 'Radio' };
        try { fs.writeFileSync(this.marker, JSON.stringify({ file: path.basename(file), name: this.recording.name }), { mode: 0o600 }); }
        catch (error) { fs.closeSync(fd); fs.unlinkSync(file); this.recording = null; throw error; }
        this.bytes = 0; this.paused = false; this.startedAt = Date.now(); this.publish();
    }
    checkDisk() {
        const stats = fs.statfsSync(this.directory);
        if (stats.bavail * stats.bsize < RESERVE_BYTES) throw new Error('Not enough free space for recording. Free space, then try again.');
        this.lastDiskCheck = Date.now();
    }
    chunk(data) {
        if (!this.recording || this.paused || !(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > 65536 || data.byteLength % 8) return false;
        const count = data.byteLength / 4;
        // A compromised renderer cannot write faster than real-time PCM plus a small delivery allowance.
        if (this.bytes + count * 2 > (Date.now() - this.startedAt + 3000) / 1000 * RATE * CHANNELS * 2) return false;
        try {
            if (Date.now() - this.lastDiskCheck > 5000) this.checkDisk();
            if (this.bytes + count * 2 > MAX_BYTES) { this.stop('Recording reached 512 MiB. Save it before starting another.'); return false; }
            const samples = new Float32Array(data); const pcm = Buffer.alloc(count * 2);
            for (let i = 0; i < count; i++) { const sample = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0; pcm.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), i * 2); }
            let written = 0;
            while (written < pcm.length) written += fs.writeSync(this.recording.fd, pcm, written, pcm.length - written);
            this.bytes += pcm.length; return true;
        } catch (error) { this.stop(error.message); return false; }
    }
    togglePause() { if (this.recording) { this.paused = !this.paused; this.publish(); } }
    stop(message = '') {
        if (!this.recording) return this.pending;
        const { file, fd, name } = this.recording;
        try {
            this.bytes = Math.floor((fs.fstatSync(fd).size - 44) / 4) * 4;
            fs.ftruncateSync(fd, this.bytes + 44); fs.writeSync(fd, wavHeader(this.bytes), 0, 44, 0); fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        this.recording = null; this.paused = false; this.pending = { file, name, bytes: this.bytes }; this.publish(message); return this.pending;
    }
    async save(destination) {
        if (!this.pending) return;
        // Destination is supplied only by the native Save dialog, never by renderer IPC.
        await fs.promises.copyFile(this.pending.file, destination);
        fs.unlinkSync(this.pending.file); fs.rmSync(this.marker, { force: true }); this.pending = null; this.bytes = 0; this.publish('Recording saved.');
    }
    discard() { if (this.recording) this.stop(); if (this.pending) fs.unlinkSync(this.pending.file); fs.rmSync(this.marker, { force: true }); this.pending = null; this.bytes = 0; this.publish('Recording discarded.'); }
}
module.exports = { RadioRecorder, wavHeader, MAX_BYTES };
