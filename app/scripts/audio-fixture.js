const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0cAAAAASUVORK5CYII=', 'base64');
function syncSafe(value) { return Buffer.from([(value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127]); }
function id3Frame(id, data) { return Buffer.concat([Buffer.from(id), syncSafe(data.length), Buffer.alloc(2), data]); }
function riffChunk(id, data) {
    const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
}
function taggedWav({ title = '', artist = '', album = '', albumArtist = artist, track = 1, disc = 1, year = 2026, genre = 'Jazz', picture = PNG, seconds = 2, frequency = 440 } = {}) {
    const rate = 16000;
    const format = Buffer.alloc(16);
    format.writeUInt16LE(1, 0); format.writeUInt16LE(1, 2); format.writeUInt32LE(rate, 4);
    format.writeUInt32LE(rate * 2, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
    const samples = Buffer.alloc(rate * seconds * 2);
    for (let i = 0; i < rate * seconds; i++) samples.writeInt16LE(Math.round(Math.sin(i * frequency * 2 * Math.PI / rate) * 14000), i * 2);
    const frames = [];
    for (const [id, value] of Object.entries({ TIT2: title, TPE1: artist, TALB: album, TPE2: albumArtist, TRCK: track, TPOS: disc, TDRC: year, TCON: genre })) {
        if (value) frames.push(id3Frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(String(value), 'utf8')])));
    }
    if (picture) frames.push(id3Frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0'), Buffer.from([3, 0]), picture])));
    const body = Buffer.concat(frames);
    const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncSafe(body.length), body]);
    const payload = Buffer.concat([Buffer.from('WAVE'), riffChunk('fmt ', format), riffChunk('id3 ', id3), riffChunk('data', samples)]);
    const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
}
module.exports = { PNG, taggedWav };
