const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const AUDIO_TYPES = Object.freeze({
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg'
});

// Only the directory explicitly selected in the native picker is traversed.
// No audio is copied, decoded or indexed in the background.
async function scanMusicFolder(folder, { signal, maxTracks = 5000, maxEntries = 50000 } = {}) {
    const root = await fs.realpath(folder);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Choose a music folder.');
    const tracks = [];
    const pending = [root];
    let entries = 0;
    let skipped = 0;
    let limited = false;
    while (pending.length && !limited) {
        signal?.throwIfAborted();
        const directory = pending.pop();
        try {
            const handle = await fs.opendir(directory);
            for await (const entry of handle) {
                signal?.throwIfAborted();
                if (++entries > maxEntries) { limited = true; break; }
                if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
                const filePath = path.join(directory, entry.name);
                if (entry.isDirectory()) pending.push(filePath);
                else if (entry.isFile() && AUDIO_TYPES[path.extname(entry.name).toLowerCase()]) {
                    tracks.push({
                        id: createHash('sha256').update(filePath).digest('hex'),
                        filePath,
                        title: path.basename(entry.name, path.extname(entry.name)),
                        artist: path.relative(root, directory) || path.basename(root),
                        relativePath: path.relative(root, filePath)
                    });
                    if (tracks.length >= maxTracks) { limited = true; break; }
                }
            }
        } catch (error) {
            signal?.throwIfAborted();
            if (directory === root) throw error;
            skipped++;
        }
    }
    tracks.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
    return { root, name: path.basename(root), tracks, skipped, limited };
}

module.exports = { AUDIO_TYPES, scanMusicFolder };
