const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanMusicFolder } = require('../src/main/local_library');
const { createLocalMediaHandler } = require('../src/main/local_media');
const { LocalPlayer } = require('../src/main/local_player');

async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytmamp-local-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const root = path.join(dir, 'music');
    await fs.mkdir(path.join(root, 'album'), { recursive: true });
    await fs.writeFile(path.join(root, '02 second.WAV'), Buffer.from('0123456789'));
    await fs.writeFile(path.join(root, '01 first.mp3'), 'first');
    await fs.writeFile(path.join(root, 'album', 'third.flac'), 'third');
    await fs.writeFile(path.join(root, 'notes.txt'), 'not audio');
    await fs.writeFile(path.join(root, '.hidden.mp3'), 'hidden');
    await fs.writeFile(path.join(dir, 'outside.wav'), 'private');
    await fs.symlink(path.join(dir, 'outside.wav'), path.join(root, 'link.wav'));
    return { dir, root, library: await scanMusicFolder(root) };
}

test('folder import includes nested audio in natural order and excludes links/other files', async (t) => {
    const { root, library } = await fixture(t);
    assert.equal(library.root, await fs.realpath(root));
    assert.deepEqual(library.tracks.map((item) => item.relativePath), ['01 first.mp3', '02 second.WAV', path.join('album', 'third.flac')]);
    assert.equal((await scanMusicFolder(root)).tracks[0].id, library.tracks[0].id);
});

test('folder scan is bounded and cancelable; an unavailable drive fails explicitly', async (t) => {
    const { root } = await fixture(t);
    const limited = await scanMusicFolder(root, { maxTracks: 1 });
    assert.equal(limited.tracks.length, 1);
    assert.equal(limited.limited, true);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(scanMusicFolder(root, { signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(scanMusicFolder(path.join(root, 'disconnected')));
});

test('media handler streams full audio, byte ranges, suffixes and HEAD for seeking', async (t) => {
    const { library } = await fixture(t);
    const track = library.tracks[1];
    const handler = createLocalMediaHandler((id) => id === track.id ? { ...track, root: library.root } : null);
    const url = `ytmamp-media://audio/${track.id}`;
    let response = await handler(new Request(url));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '0123456789');
    response = await handler(new Request(url, { headers: { range: 'bytes=2-5' } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await response.text(), '2345');
    response = await handler(new Request(url, { headers: { range: 'bytes=-3' } }));
    assert.equal(await response.text(), '789');
    response = await handler(new Request(url, { method: 'HEAD' }));
    assert.equal(response.headers.get('content-length'), '10');
    assert.equal(await response.text(), '');
});

test('media handler rejects unknown IDs, malformed ranges and renamed symlink escapes', async (t) => {
    const { dir, library } = await fixture(t);
    const track = library.tracks[1];
    const handler = createLocalMediaHandler((id) => id === track.id ? { ...track, root: library.root } : null);
    const url = `ytmamp-media://audio/${track.id}`;
    assert.equal((await handler(new Request('ytmamp-media://audio/' + 'f'.repeat(64)))).status, 404);
    for (const range of ['bytes=50-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=9007199254740993-']) {
        assert.equal((await handler(new Request(url, { headers: { range } }))).status, 416, range);
    }
    await fs.unlink(track.filePath);
    await fs.symlink(path.join(dir, 'outside.wav'), track.filePath);
    assert.equal((await handler(new Request(url))).status, 403);
});

test('queue restores a selected track paused and keeps paths out of renderer snapshots', async (t) => {
    const { library } = await fixture(t);
    const player = new LocalPlayer();
    const commands = [];
    player.on('audio', (command) => commands.push(command));
    player.setLibrary(library, library.tracks[1].id);
    assert.equal(player.index, 1);
    assert.equal(commands.at(-1).autoplay, false);
    assert.equal(player.state.playing, false);
    assert.equal(JSON.stringify(player.catalog()).includes(library.root), false);
    player.pause();
    assert.equal(commands.at(-1).action, 'pause');
});

test('stale audio events cannot advance or overwrite a newer track', async (t) => {
    const { library } = await fixture(t);
    const player = new LocalPlayer();
    player.setLibrary(library);
    const old = { id: player.current.id, revision: player.revision, positionSec: 0, durationSec: 10, playing: false, ended: true };
    player.command({ cmd: 'next' });
    assert.equal(player.receive(old), false);
    assert.equal(player.index, 1);
    assert.equal(player.state.durationSec, 0);
});

test('queue finishes at end, repeat wraps, and shuffle chooses a different track', async (t) => {
    const { library } = await fixture(t);
    const player = new LocalPlayer({ random: () => 0 });
    player.setLibrary(library);
    player.select(2, false);
    const ended = () => player.receive({ id: player.current.id, revision: player.revision, positionSec: 10, durationSec: 10, playing: false, ended: true });
    ended();
    assert.equal(player.index, 2);
    player.command({ cmd: 'repeat' });
    ended();
    assert.equal(player.index, 0);
    player.command({ cmd: 'shuffle' });
    player.command({ cmd: 'next' });
    assert.equal(player.index, 1);
    assert.equal(player.command({ cmd: 'setVolume', value: NaN }), false);
    assert.equal(player.command({ cmd: 'seek', valueSec: -1 }), false);
});

test('empty folders unload previous audio and clear the active track', () => {
    const player = new LocalPlayer();
    let command;
    player.on('audio', (value) => { command = value; });
    player.setLibrary({ name: 'empty', tracks: [] });
    assert.equal(command.action, 'unload');
    assert.equal(player.track(), null);
    assert.equal(player.command({ cmd: 'playPause' }), false);
});
