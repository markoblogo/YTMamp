const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { LocalCollection } = require('../src/main/local_collection');
const { LocalPlayer } = require('../src/main/local_player');
const { createLocalMediaHandler } = require('../src/main/local_media');
const { PNG } = require('../scripts/audio-fixture');
const view = require('../src/renderer/library_view');

async function setup(t, options = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytmamp-collection-'));
    const first = path.join(dir, 'first');
    const album = path.join(first, 'album');
    const second = path.join(dir, 'second');
    const profile = path.join(dir, 'profile');
    await fs.mkdir(album, { recursive: true }); await fs.mkdir(second);
    await fs.writeFile(path.join(album, 'z-first.wav'), 'original first audio');
    await fs.writeFile(path.join(album, 'a-second.wav'), 'original second audio');
    await fs.writeFile(path.join(second, 'other.wav'), 'original other audio');
    let reads = 0;
    const readMetadata = async (file) => {
        reads++;
        return { metadata: { title: file.includes('z-first') ? 'First movement' : file.includes('a-second') ? 'Second movement' : 'Other song',
            artist: 'Björk', albumArtist: 'Björk', album: file.includes('other') ? 'Night Radio' : 'Café du matin',
            trackNo: file.includes('a-second') ? 2 : 1, discNo: 1, genre: 'Jazz', year: 2026 }, picture: PNG };
    };
    const collection = new LocalCollection({ directory: profile, readMetadata, ...options });
    t.after(async () => { collection.close(); await fs.rm(dir, { recursive: true, force: true }); });
    await collection.load();
    return { dir, first, second, album, profile, collection, readMetadata, reads: () => reads };
}

test('multiple roots and nested roots produce one tagged collection with stable album order', async (t) => {
    const f = await setup(t);
    const snapshot = await f.collection.update({ folders: [f.first, f.album, f.second, f.first] });
    assert.equal(snapshot.roots.length, 3);
    assert.equal(snapshot.tracks.length, 3);
    assert.deepEqual(snapshot.tracks.slice(0, 2).map((track) => track.title), ['First movement', 'Second movement']);
    assert.equal(f.reads(), 3);
    const nested = snapshot.roots.find((root) => root.name === 'album');
    assert.equal(view.filterTracks(snapshot.tracks, { rootId: nested.id }).length, 2);
    await f.collection.update();
    assert.equal(f.reads(), 3, 'unchanged files reuse cached tags');
    await fs.writeFile(path.join(f.album, 'z-first.wav'), 'changed original first audio');
    await f.collection.update();
    assert.equal(f.reads(), 4, 'only changed audio is parsed again');
});

test('restart restores folders, tags and artwork; removing a root keeps original files', async (t) => {
    const f = await setup(t);
    await f.collection.update({ folders: [f.first, f.second] });
    const reopened = new LocalCollection({ directory: f.profile, readMetadata: f.readMetadata });
    t.after(() => reopened.close());
    const restored = await reopened.load();
    assert.equal(restored.tracks.length, 3);
    assert.equal(restored.tracks[0].artist, 'Björk');
    assert.match(restored.tracks[0].cover, /^ytmamp-media:\/\/art\/[a-f0-9]{64}$/);
    const handler = createLocalMediaHandler((id, kind) => kind === 'art' ? reopened.artwork(id) : null);
    const response = await handler(new Request(restored.tracks[0].cover));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    await reopened.update({ removeId: reopened.roots[1].id });
    assert.equal(reopened.snapshot().tracks.length, 2);
    assert.equal(await fs.readFile(path.join(f.second, 'other.wav'), 'utf8'), 'original other audio');
    await reopened.update({ removeId: reopened.roots[0].id });
    const empty = new LocalCollection({ directory: f.profile }); t.after(() => empty.close());
    await empty.load(f.first);
    assert.equal(empty.snapshot().roots.length, 0, 'removed folders do not reappear through legacy migration');
});

test('an unplugged root retains searchable albums as offline and reconnect restores availability', async (t) => {
    const f = await setup(t);
    await f.collection.update({ folders: [f.first, f.second] });
    const disconnected = f.second + '-disconnected';
    await fs.rename(f.second, disconnected);
    const offline = await f.collection.update();
    assert.equal(offline.tracks.length, 3);
    assert.equal(offline.tracks.filter((track) => !track.available).length, 1);
    assert.equal(view.filterTracks(offline.tracks, { query: 'night radio' }).length, 1);
    await fs.rename(disconnected, f.second);
    assert.equal((await f.collection.update()).tracks.every((track) => track.available), true);
    assert.equal(f.reads(), 3);
});

test('cancelation preserves the committed library and files; filename and folder art are fallbacks', async (t) => {
    const f = await setup(t, { readMetadata: async () => ({ metadata: {}, picture: null }) });
    await fs.writeFile(path.join(f.album, 'cover.png'), PNG);
    const before = await f.collection.update({ folders: [f.first] });
    assert.equal(before.tracks.length, 2);
    assert.equal(before.tracks[0].title, 'a-second');
    assert.ok(before.tracks[0].cover);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.collection.update({ folders: [f.second], signal: controller.signal }), { name: 'AbortError' });
    assert.equal(f.collection.snapshot().roots.length, 1);
    assert.equal(await fs.readFile(path.join(f.album, 'a-second.wav'), 'utf8'), 'original second audio');
});

test('artwork cache stays within its byte budget and public catalogs contain no absolute paths', async (t) => {
    const f = await setup(t, { coverBudget: PNG.length + 1 });
    await f.collection.update({ folders: [f.first] });
    await f.collection.saveCover(Buffer.concat([PNG, Buffer.from([1])]));
    const files = await fs.readdir(f.collection.artworkDirectory);
    let bytes = 0; for (const file of files) bytes += (await fs.stat(path.join(f.collection.artworkDirectory, file))).size;
    assert.ok(bytes <= PNG.length + 1);
    const player = new LocalPlayer(); player.setLibrary(f.collection.snapshot());
    assert.equal(JSON.stringify(player.catalog()).includes(f.dir), false);
    const unknown = 'f'.repeat(64);
    assert.equal(f.collection.artwork(unknown), null);
});

test('adding folders during playback keeps the media revision; album playback stays in that album', async (t) => {
    const f = await setup(t);
    const first = await f.collection.update({ folders: [f.first] });
    const player = new LocalPlayer(); const commands = [];
    player.on('audio', (command) => commands.push(command));
    player.setLibrary(first); player.playAlbum(first.tracks[0].albumId);
    player.receive({ id: player.current.id, revision: player.revision, positionSec: 1, durationSec: 8, playing: true });
    const revision = player.revision; const count = commands.length;
    player.setLibrary(await f.collection.update({ folders: [f.second] }), '', { preservePlayback: true });
    assert.equal(player.revision, revision); assert.equal(commands.length, count); assert.equal(player.state.playing, true);
    player.command({ cmd: 'next' }); assert.equal(player.current.title, 'Second movement');
    const endedRevision = player.revision;
    player.receive({ id: player.current.id, revision: endedRevision, positionSec: 8, durationSec: 8, playing: false, ended: true });
    assert.equal(player.revision, endedRevision, 'album ends without starting an unrelated album');
});

test('search matches accent-insensitive artist/title/album/genre and supports folder and album filters', () => {
    const tracks = [{ id: 'one', title: 'Пісня', artist: 'Björk', album: 'Café du matin', genre: 'Jazz', rootId: 'a', rootIds: ['a', 'b'], albumId: 'album1', available: false },
        { id: 'two', title: 'Other', artist: 'Someone', album: 'Night', rootId: 'b', albumId: 'album2', available: true }];
    assert.equal(view.filterTracks(tracks, { query: 'bjork cafe jazz' }).length, 1);
    assert.equal(view.filterTracks(tracks, { query: 'ПІСНЯ' }).length, 1);
    assert.equal(view.filterTracks(tracks, { rootId: 'b' }).length, 2);
    assert.equal(view.filterTracks(tracks, { albumId: 'album2', query: 'other' }).length, 1);
    assert.equal(view.albums(tracks).find((album) => album.id === 'album1').available, 0);
});

test('first migration restores the saved track after indexing an initially empty cache', async (t) => {
    const f = await setup(t);
    await f.collection.load(f.first);
    const selectedId = createHash('sha256').update(await fs.realpath(path.join(f.album, 'a-second.wav'))).digest('hex');
    const player = new LocalPlayer();
    player.setLibrary(f.collection.snapshot(), selectedId);
    assert.equal(player.current, null);
    player.setLibrary(await f.collection.update(), selectedId, { preservePlayback: true });
    assert.equal(player.current.id, selectedId);
    assert.equal(player.current.title, 'Second movement');
    assert.equal(player.state.playing, false);
});

test('a folder album with mixed artists is labeled as a compilation', () => {
    const result = view.albums([{ id: 'a', albumId: 'folder', album: 'Music', artist: 'One' }, { id: 'b', albumId: 'folder', album: 'Music', artist: 'Two' }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].artist, 'Various artists');
    assert.equal(result[0].count, 2);
});

test('corrupt manifests recover without trusting cached paths outside added roots', async (t) => {
    const f = await setup(t);
    await fs.mkdir(f.profile, { recursive: true }); await fs.writeFile(f.collection.manifest, '{bad json');
    await f.collection.load(f.first);
    assert.equal(f.collection.roots.length, 1);
    const outside = path.join(f.dir, 'outside.wav'); const id = createHash('sha256').update(outside).digest('hex');
    await fs.writeFile(f.collection.manifest, JSON.stringify({ schema: 1, roots: f.collection.roots, entries: { [id]: { id, filePath: outside, title: 'private' } } }));
    await f.collection.load(); assert.equal(f.collection.entries[id], undefined);
});
