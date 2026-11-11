const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MetadataReader } = require('../src/main/metadata_reader');
const { LocalCollection } = require('../src/main/local_collection');
const { PNG, taggedWav } = require('../scripts/test-audio-fixture');

test('real metadata worker reads embedded UTF-8 tags, track numbers and front-cover bytes', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ytmamp-tags-'));
    const file = path.join(directory, 'filename-does-not-match.wav');
    const bytes = taggedWav({ title: 'Première piste', artist: 'Björk', album: 'Café du matin', track: 2, disc: 1 });
    await fs.writeFile(file, bytes);
    const reader = new MetadataReader();
    t.after(async () => { reader.stop(); await fs.rm(directory, { recursive: true, force: true }); });
    const parsed = await reader.read(file);
    assert.equal(parsed.metadata.title, 'Première piste'); assert.equal(parsed.metadata.artist, 'Björk');
    assert.equal(parsed.metadata.album, 'Café du matin'); assert.equal(parsed.metadata.trackNo, 2); assert.equal(parsed.metadata.discNo, 1);
    assert.deepEqual(Buffer.from(parsed.picture), PNG);
    assert.deepEqual(await fs.readFile(file), bytes, 'reading tags never rewrites audio');
    const collection = new LocalCollection({ directory: path.join(directory, 'profile') });
    t.after(() => collection.close());
    await collection.load(); const result = await collection.update({ folders: [directory] });
    assert.equal(result.tracks[0].title, 'Première piste'); assert.ok(result.tracks[0].cover);
    const broken = path.join(directory, 'broken.mp3'); await fs.writeFile(broken, 'bad audio');
    await assert.rejects(reader.read(broken));
    assert.equal((await reader.read(file)).metadata.title, 'Première piste');
});
