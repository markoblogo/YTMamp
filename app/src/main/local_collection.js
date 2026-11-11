const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { scanMusicFolder } = require('./local_library');
const { MetadataReader, cleanText, imageMime, MAX_ARTWORK_BYTES } = require('./metadata_reader');

const MAX_ROOTS = 20;
const MAX_TRACKS = 10000;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_COVER_BYTES = 32 * 1024 * 1024;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const validId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inside = (root, file) => { const relative = path.relative(root, file); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const rootLabel = (root) => [path.basename(path.dirname(root)), path.basename(root)].filter(Boolean).join('/');

class LocalCollection {
    constructor({ directory, readMetadata, coverBudget = MAX_COVER_BYTES } = {}) {
        this.directory = directory;
        this.manifest = path.join(directory, 'local-library-v1.json');
        this.artworkDirectory = path.join(directory, 'local-artwork');
        this.reader = new MetadataReader();
        this.readMetadata = readMetadata || ((file, signal) => this.reader.read(file, signal));
        this.coverBudget = coverBudget;
        this.roots = [];
        this.entries = {};
        this.covers = new Map();
    }
    async load(legacyFolder = '') {
        await fs.mkdir(this.artworkDirectory, { recursive: true });
        this.directory = await fs.realpath(this.directory);
        this.manifest = path.join(this.directory, 'local-library-v1.json');
        this.artworkDirectory = await fs.realpath(path.join(this.directory, 'local-artwork'));
        let loaded = false;
        try {
            if ((await fs.stat(this.manifest)).size > MAX_MANIFEST_BYTES) throw new Error('Oversized manifest');
            const saved = JSON.parse(await fs.readFile(this.manifest, 'utf8'));
            if (saved.schema !== 1 || !Array.isArray(saved.roots) || typeof saved.entries !== 'object' || !saved.entries) throw new Error('Invalid manifest');
            const roots = saved.roots.slice(0, MAX_ROOTS).filter((root) => typeof root.path === 'string' && path.isAbsolute(root.path) && root.path.length < 4096 && root.id === hash(root.path));
            const entries = {};
            for (const [id, entry] of Object.entries(saved.entries).slice(0, MAX_TRACKS)) {
                if (!validId(id) || !entry || typeof entry.filePath !== 'string' || id !== hash(entry.filePath) || !roots.some((root) => inside(root.path, entry.filePath))) continue;
                entries[id] = { id, filePath: entry.filePath, size: entry.size, mtimeMs: entry.mtimeMs,
                    title: cleanText(entry.title), artist: cleanText(entry.artist), album: cleanText(entry.album), albumArtist: cleanText(entry.albumArtist),
                    genre: cleanText(entry.genre), year: Number(entry.year) || 0, trackNo: Number(entry.trackNo) || 0, discNo: Number(entry.discNo) || 0,
                    durationSec: Number(entry.durationSec) || 0, embedded: entry.embedded === true,
                    coverKey: validId(entry.coverKey) ? entry.coverKey : '', coverMime: ['image/jpeg', 'image/png', 'image/webp'].includes(entry.coverMime) ? entry.coverMime : '' };
            }
            this.entries = entries;
            this.roots = roots.map((root) => ({ id: root.id, path: root.path, name: path.basename(root.path), label: rootLabel(root.path),
                status: 'offline', trackIds: Array.isArray(root.trackIds) ? root.trackIds.filter((id) => entries[id]).slice(0, MAX_TRACKS) : [], limited: !!root.limited, skipped: 0 }));
            // Availability checks are shallow; only explicitly added roots are inspected.
            for (const root of this.roots) {
                try { root.status = (await fs.stat(root.path)).isDirectory() ? 'ready' : 'offline'; } catch { root.status = 'offline'; }
            }
            loaded = true;
        } catch { /* Missing or corrupt cache: migrate the stage 1 folder safely. */ }
        if (!loaded && typeof legacyFolder === 'string' && path.isAbsolute(legacyFolder)) {
            let legacyRoot = path.resolve(legacyFolder);
            try { legacyRoot = await this.canonicalFolder(legacyRoot); } catch { /* Keep an offline legacy root. */ }
            this.roots = [this.makeRoot(legacyRoot)];
        }
        for (const file of await fs.readdir(this.artworkDirectory)) {
            if (!/^[a-f0-9]{64}\.bin$/.test(file)) continue;
            try {
                const stat = await fs.lstat(path.join(this.artworkDirectory, file));
                if (stat.isFile()) this.covers.set(file.slice(0, -4), { size: stat.size, time: stat.mtimeMs });
            } catch { /* A cache entry may have been removed. */ }
        }
        await this.pruneCovers();
        return this.snapshot();
    }
    makeRoot(root) {
        return { id: hash(root), path: root, name: path.basename(root), label: rootLabel(root), status: 'ready', trackIds: [], limited: false, skipped: 0 };
    }
    async canonicalFolder(folder) {
        const real = await fs.realpath(folder);
        if (!(await fs.stat(real)).isDirectory()) throw new Error('Choose a music folder.');
        return real;
    }
    async update({ folders = [], removeId = '', signal, onProgress = () => {} } = {}) {
        signal?.throwIfAborted();
        const roots = this.roots.filter((root) => root.id !== removeId).map((root) => ({ ...root, trackIds: [...root.trackIds] }));
        for (const folder of folders) {
            const real = await this.canonicalFolder(folder);
            if (!roots.some((root) => root.path === real)) {
                if (roots.length >= MAX_ROOTS) throw new Error(`The library supports up to ${MAX_ROOTS} folders.`);
                roots.push(this.makeRoot(real));
            }
        }
        const entries = {};
        const sidecars = new Map();
        let entryCount = 0;
        let processed = 0;
        let previousProgress = 0;
        for (const root of roots) {
            signal?.throwIfAborted();
            let scanned;
            try { scanned = await scanMusicFolder(root.path, { signal }); }
            catch (error) {
                signal?.throwIfAborted();
                root.status = 'offline';
                root.trackIds = root.trackIds.filter((id) => this.entries[id]);
                for (const id of root.trackIds) {
                    if (!entries[id] && entryCount < MAX_TRACKS) { entries[id] = this.entries[id]; entryCount++; }
                }
                continue;
            }
            root.status = 'ready'; root.limited = scanned.limited; root.skipped = scanned.skipped;
            root.trackIds = [];
            for (const scannedTrack of scanned.tracks) {
                signal?.throwIfAborted();
                if (!entries[scannedTrack.id] && entryCount >= MAX_TRACKS) { root.limited = true; break; }
                if (entries[scannedTrack.id]) { root.trackIds.push(scannedTrack.id); continue; }
                try {
                    const real = await fs.realpath(scannedTrack.filePath);
                    if (real !== scannedTrack.filePath || !inside(root.path, real)) continue;
                    const stat = await fs.stat(real);
                    if (!stat.isFile()) continue;
                    const cached = this.entries[scannedTrack.id];
                    let entry;
                    let picture;
                    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) entry = { ...cached };
                    else {
                        let parsed;
                        try { parsed = await this.readMetadata(real, signal); }
                        catch { signal?.throwIfAborted(); parsed = { metadata: {} }; }
                        entry = { id: scannedTrack.id, filePath: real, size: stat.size, mtimeMs: stat.mtimeMs, ...parsed.metadata };
                        picture = parsed.picture;
                        entry.embedded = !!picture;
                    }
                    if (!entry.embedded) {
                        const directory = path.dirname(real);
                        if (!sidecars.has(directory)) sidecars.set(directory, this.readFolderArtwork(directory, root.path));
                        picture = await sidecars.get(directory);
                        entry.coverKey = ''; entry.coverMime = '';
                    }
                    if (picture) Object.assign(entry, await this.saveCover(picture));
                    entries[entry.id] = entry;
                    entryCount++;
                    root.trackIds.push(entry.id);
                    processed++;
                    if (Date.now() - previousProgress > 200) { onProgress({ processed, folder: root.name }); previousProgress = Date.now(); }
                } catch { signal?.throwIfAborted(); root.skipped++; }
            }
        }
        signal?.throwIfAborted();
        for (const root of roots) root.trackIds = root.trackIds.filter((id) => entries[id]);
        await this.commit(roots, entries);
        return this.snapshot();
    }
    async readFolderArtwork(directory, root) {
        for (const name of ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'front.png', 'cover.webp']) {
            const file = path.join(directory, name);
            try {
                if (await fs.realpath(file) !== file || !inside(root, file)) continue;
                const stat = await fs.stat(file);
                if (!stat.isFile() || stat.size > MAX_ARTWORK_BYTES) continue;
                const data = await fs.readFile(file);
                if (imageMime(data)) return data;
            } catch { /* Sidecar art is optional. */ }
        }
        return null;
    }
    async saveCover(data) {
        const mime = imageMime(data);
        if (!mime || data.length > MAX_ARTWORK_BYTES || data.length > this.coverBudget) return { coverKey: '', coverMime: '' };
        const key = hash(data);
        if (!this.covers.has(key)) {
            await fs.writeFile(path.join(this.artworkDirectory, `${key}.bin`), data, { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
            this.covers.set(key, { size: data.length, time: Date.now() });
        } else this.covers.get(key).time = Date.now();
        await this.pruneCovers();
        return { coverKey: this.covers.has(key) ? key : '', coverMime: mime };
    }
    async pruneCovers() {
        let bytes = [...this.covers.values()].reduce((sum, entry) => sum + entry.size, 0);
        for (const [key, entry] of [...this.covers].sort((a, b) => a[1].time - b[1].time)) {
            if (bytes <= this.coverBudget) break;
            await fs.unlink(path.join(this.artworkDirectory, `${key}.bin`)).catch(() => {});
            this.covers.delete(key); bytes -= entry.size;
        }
    }
    async commit(roots, entries) {
        const data = JSON.stringify({ schema: 1, roots, entries });
        if (Buffer.byteLength(data) > MAX_MANIFEST_BYTES) throw new Error('The library metadata cache is full. Remove a folder to continue.');
        await fs.mkdir(this.directory, { recursive: true });
        const temporary = `${this.manifest}.${randomBytes(6).toString('hex')}.tmp`;
        try { await fs.writeFile(temporary, data); await fs.rename(temporary, this.manifest); }
        finally { await fs.unlink(temporary).catch(() => {}); }
        this.roots = roots; this.entries = entries;
    }
    snapshot() {
        const map = new Map();
        const memberships = new Map();
        for (const root of this.roots) {
            for (const id of root.trackIds) {
                const entry = this.entries[id];
                if (!memberships.has(id)) memberships.set(id, []);
                memberships.get(id).push(root.id);
                if (!entry || (map.has(id) && map.get(id).available)) continue;
                const relativePath = path.relative(root.path, entry.filePath);
                const folder = path.basename(path.dirname(entry.filePath));
                const artist = cleanText(entry.artist) || 'Unknown artist';
                const album = cleanText(entry.album) || folder;
                const albumArtist = cleanText(entry.albumArtist) || artist;
                const albumId = hash(entry.album ? `${albumArtist.toLowerCase()}\n${album.toLowerCase()}` : `folder\n${path.dirname(entry.filePath)}`);
                const cover = entry.coverKey && this.covers.has(entry.coverKey) ? `ytmamp-media://art/${entry.coverKey}` : '';
                map.set(id, { ...entry, title: cleanText(entry.title) || path.basename(entry.filePath, path.extname(entry.filePath)),
                    artist, album, albumArtist, albumId, rootId: root.id, root: root.path, rootName: root.name,
                    relativePath, available: root.status === 'ready', cover });
            }
        }
        const tracks = [...map.values()].map((track) => ({ ...track, rootIds: memberships.get(track.id) })).sort((a, b) => a.albumArtist.localeCompare(b.albumArtist) || a.album.localeCompare(b.album) ||
            (a.discNo || 0) - (b.discNo || 0) || (a.trackNo || 0) - (b.trackNo || 0) || a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
        return { name: 'Music library', roots: this.roots.map(({ path: _path, trackIds, ...root }) => ({ ...root, count: trackIds.length })),
            tracks, limited: this.roots.some((root) => root.limited), skipped: this.roots.reduce((sum, root) => sum + (root.skipped || 0), 0) };
    }
    artwork(key) {
        if (!validId(key) || !this.covers.has(key)) return null;
        const entry = Object.values(this.entries).find((item) => item.coverKey === key);
        return entry ? { root: this.artworkDirectory, filePath: path.join(this.artworkDirectory, `${key}.bin`), mimeType: entry.coverMime } : null;
    }
    close() { this.reader.stop(); }
}

module.exports = { LocalCollection, MAX_ROOTS, MAX_TRACKS, MAX_COVER_BYTES };
