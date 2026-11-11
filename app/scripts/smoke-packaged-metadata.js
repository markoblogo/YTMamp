// Executed with the actual signed app binary in ELECTRON_RUN_AS_NODE mode.
// Exercises worker/module loading inside app.asar, not the development checkout.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { taggedWav } = require('./audio-fixture');
async function run() {
    const appDirectory = process.argv[2];
    const { MetadataReader } = require(path.join(appDirectory, 'Contents/Resources/app.asar/src/main/metadata_reader.js'));
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ytmamp-packaged-tags-'));
    const reader = new MetadataReader();
    try {
        const file = path.join(temporary, 'test.wav');
        await fs.writeFile(file, taggedWav({ title: 'Packaged worker', artist: 'Test artist', album: 'Test album' }));
        const result = await reader.read(file);
        assert.equal(result.metadata.title, 'Packaged worker');
        assert.ok(result.picture?.length);
        console.log('PACKAGED_METADATA PASS: signed runtime, ASAR worker, parser and artwork');
    } finally {
        reader.stop(); await fs.rm(temporary, { recursive: true, force: true });
    }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
