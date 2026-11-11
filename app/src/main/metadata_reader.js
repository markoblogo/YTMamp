const path = require('node:path');
const { Worker } = require('node:worker_threads');

const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
const cleanText = (value, limit = 300) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
function imageMime(data) {
    if (!data || data.length < 12) return '';
    if (Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
    if (Buffer.from(data.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(data.subarray(8, 12)).toString() === 'WEBP') return 'image/webp';
    return '';
}
function normalizeMetadata(common = {}, format = {}) {
    const number = (value) => Number.isInteger(value) && value > 0 && value < 1000000 ? value : 0;
    return {
        title: cleanText(common.title), artist: cleanText(common.artist || common.artists?.slice(0, 5).join(', ')),
        album: cleanText(common.album), albumArtist: cleanText(common.albumartist),
        genre: Array.isArray(common.genre) ? common.genre.slice(0, 8).map((value) => cleanText(value, 80)).filter(Boolean).join(', ') : '',
        year: number(common.year), trackNo: number(common.track?.no), discNo: number(common.disk?.no),
        durationSec: Number.isFinite(format.duration) && format.duration > 0 ? format.duration : 0
    };
}

// One idle, unreferenced worker; a damaged tag cannot freeze the UI or a whole scan.
class MetadataReader {
    constructor({ timeoutMs = 5000 } = {}) { this.timeoutMs = timeoutMs; this.worker = null; this.pending = null; this.sequence = 0; }
    read(filePath, signal) {
        signal?.throwIfAborted();
        if (this.pending) return Promise.reject(new Error('Metadata reader is busy.'));
        if (!this.worker) {
            const worker = new Worker(path.join(__dirname, 'metadata_worker.js'), {
                resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 }
            });
            this.worker = worker;
            worker.on('message', (message) => {
                if (this.worker !== worker || !this.pending || message.id !== this.pending.id) return;
                const pending = this.pending;
                pending.finish();
                if (message.error) pending.reject(new Error(message.error));
                else pending.resolve(message.result);
            });
            worker.on('error', (error) => { if (this.worker === worker) this.stop(error); });
            worker.on('exit', (code) => { if (this.worker === worker) this.stop(new Error(`Metadata worker exited (${code}).`)); });
            worker.unref();
        }
        return new Promise((resolve, reject) => {
            const id = ++this.sequence;
            const abort = () => this.stop(signal.reason || new Error('Metadata scan canceled.'));
            const timer = setTimeout(() => this.stop(new Error('Metadata read timed out.')), this.timeoutMs);
            this.pending = { id, resolve, reject, finish: () => {
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                this.pending = null; this.worker?.unref();
            } };
            signal?.addEventListener('abort', abort, { once: true });
            this.worker.ref();
            this.worker.postMessage({ id, filePath });
            if (signal?.aborted) abort();
        });
    }
    stop(error = new Error('Metadata reader closed.')) {
        const worker = this.worker;
        const pending = this.pending;
        if (pending) { pending.finish(); pending.reject(error); }
        this.worker = null;
        worker?.terminate();
    }
}

module.exports = { MetadataReader, cleanText, imageMime, normalizeMetadata, MAX_ARTWORK_BYTES };
