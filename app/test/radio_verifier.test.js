const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { RadioStationVerifier } = require('../src/renderer/radio_verifier');
const { boundedPreview } = require('../src/main/radio_network');

function audioFactory(mode = () => 'good') {
    const stats = { active: 0, maximum: 0, created: 0, stopped: 0 };
    const createAudio = () => {
        stats.created++; let active = false;
        return {
            play() {
                assert.equal(this.muted, true); assert.match(this.src, /^ytmamp-media:\/\/radio-check\//);
                active = true; stats.active++; stats.maximum = Math.max(stats.maximum, stats.active);
                const kind = mode(this.src);
                if (kind !== 'hang') setTimeout(() => kind === 'good' ? this.onplaying?.() : this.onerror?.(), 2);
                return Promise.resolve();
            },
            pause() { if (active) { active = false; stats.active--; stats.stopped++; } },
            removeAttribute(name) { assert.equal(name, 'src'); this.src = ''; }, load() {}
        };
    };
    return { stats, createAudio };
}
test('catalog only exposes decodable previews and bounds concurrent silent connections', async () => {
    const fixture = audioFactory((url) => url.endsWith('/bad') ? 'bad' : 'good'); const reports = []; const cards = [];
    const verifier = new RadioStationVerifier({ ...fixture, online: () => true, report: async (id, ok) => { reports.push({ id, ok }); } });
    const result = await verifier.verify(['a', 'b', 'bad', 'c', 'd', 'e'].map((id) => ({ id })), (s) => cards.push(s));
    assert.equal(result.hidden, 1); assert.equal(cards.length, 5); assert.equal(cards.some((s) => s.id === 'bad'), false);
    assert.equal(reports.find((s) => s.id === 'bad').ok, false);
    assert.equal(fixture.stats.maximum, 3); assert.equal(fixture.stats.active, 0); assert.equal(fixture.stats.stopped, 6);
});
test('fresh checks skip connections without extending their expiry; expired checks decode again', async () => {
    const fixture = audioFactory(); let reports = 0; const cards = [];
    const verifier = new RadioStationVerifier({ ...fixture, online: () => true, report: async () => { reports++; } });
    const checkedAt = Date.now() - 600000;
    await verifier.verify([{ id: 'cached', checkedAt }, { id: 'expired', checkedAt: Date.now() - 900001 }], (s) => cards.push(s));
    assert.equal(fixture.stats.created, 1); assert.equal(reports, 1); assert.equal(cards.find((s) => s.id === 'cached').checkedAt, checkedAt);
});
test('canceling or going offline releases previews without marking addresses bad', async () => {
    const fixture = audioFactory(() => 'hang'); const reports = [];
    const verifier = new RadioStationVerifier({ ...fixture, online: () => true, report: async (...args) => reports.push(args), timeout: 20 });
    const pending = verifier.verify([{ id: 'a' }, { id: 'b' }]); verifier.cancel();
    assert.equal((await pending).canceled, true); assert.equal(reports.length, 0); assert.equal(fixture.stats.active, 0);
    verifier.online = () => false;
    await verifier.verify([{ id: 'offline' }]); assert.equal(reports.length, 0);
});
test('a timeout is hidden and one alternate address is decoded before showing a card', async () => {
    const fixture = audioFactory((url) => url.endsWith('/slow') ? 'hang' : 'good'); const cards = [];
    const verifier = new RadioStationVerifier({ ...fixture, online: () => true, timeout: 10, report: async (id, ok) => ({ alternate: ok ? null : { id: 'alternate' } }) });
    const result = await verifier.verify([{ id: 'slow' }], (s) => cards.push(s));
    assert.equal(result.hidden, 1); assert.deepEqual(cards.map((s) => s.id), ['alternate']); assert.equal(fixture.stats.active, 0);
});
test('preview transport ends after 128 KiB and closes the upstream stream', async () => {
    const source = Readable.from((async function* () { for (let i = 0; i < 100; i++) yield Buffer.alloc(65536); })());
    let bytes = 0; for await (const chunk of boundedPreview(source)) bytes += chunk.length;
    assert.equal(bytes, 131072); assert.equal(source.destroyed, true);
});
