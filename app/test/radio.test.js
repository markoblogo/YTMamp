const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkedUrl, publicAddress } = require('../src/main/radio_network');
const { RadioLibrary, stationFrom, frequency, filterStations } = require('../src/main/radio_library');
const { RadioPlayer } = require('../src/main/radio_player');
const { RadioRecorder } = require('../src/main/radio_recorder');
const raw = (name, url, extra = {}) => ({ name, url, countrycode: 'FR', state: 'Loire-Atlantique', language: 'French', tags: 'jazz', geo_lat: 47.22, geo_long: -1.55, ...extra });
function fixture(t, browser = { search: async () => [], click() {} }) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmamp-radio-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { directory, library: new RadioLibrary({ directory, browser }) };
}
test('radio URLs reject local, mapped, credential and non-HTTP destinations', () => {
    for (const url of ['file:///etc/passwd', 'http://127.0.0.1/a', 'http://2130706433/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a', 'http://10.0.0.1', 'https://user:pass@example.org', 'http://169.254.169.254/latest', 'http://station.local']) assert.throws(() => checkedUrl(url), url);
    assert.equal(checkedUrl('https://radio.example.org:8443/stream').protocol, 'https:');
    assert.equal(publicAddress('8.8.8.8'), true); assert.equal(publicAddress('100.100.1.2'), false);
    assert.equal(publicAddress('2606:4700:4700::1111'), true); assert.equal(publicAddress('fd00::1'), false);
});
test('FM parsing requires an explicit band/unit and never invents frequencies', () => {
    assert.equal(frequency('Radio Jazz 92.1 FM'), 92.1); assert.equal(frequency('FM 101,3 Jazz'), 101.3);
    assert.equal(frequency('Jazz 105.2 MHz'), 105.2);
    for (const name of ['Jazz 92', 'Station 2026', 'DAB 220 MHz', 'AM 1050', 'Online jazz']) assert.equal(frequency(name), null);
});
test('search combines provider filters, sorts, persists favorites and handles directory outages', async (t) => {
    let params; let fail = false;
    const { directory, library } = fixture(t, { search: async (query) => { params = query; if (fail) throw new Error('offline'); return [raw('Zèbre FM 98.2', 'https://example.org/z'), raw('Alpha FM 92.1', 'https://example.org/a')]; } });
    const result = await library.search({ genre: 'jazz', language: 'French', country: 'FR', region: 'Loire', sort: 'name' });
    assert.deepEqual(result.stations.map((s) => s.name), ['Alpha FM 92.1', 'Zèbre FM 98.2']);
    assert.equal(params.tag, 'jazz'); assert.equal(params.countrycode, 'FR'); assert.equal(params.state, 'Loire');
    assert.equal('url' in result.stations[0], false);
    library.toggleFavorite(result.stations[0].id);
    const restored = new RadioLibrary({ directory });
    assert.equal(restored.favorites.size, 1); assert.equal(restored.snapshot().stations[0].favorite, true);
    fail = true;
    const cached = await library.search({ name: 'alpha', genre: 'jazz', country: 'FR' });
    assert.equal(cached.cached, true); assert.equal(cached.stations.length, 1); assert.ok(cached.error);
    assert.equal(filterStations([...library.stations.values()], { name: 'zebre', language: 'French' }).length, 1);
});
test('local dial has only nearby supplied frequencies; custom local values follow location', async (t) => {
    const { library } = fixture(t);
    const stations = [raw('Local FM 101.3', 'https://example.org/1'), raw('Local FM 92.1', 'https://example.org/2'), raw('Remote FM 90.0', 'https://example.org/3', { geo_lat: 43.7, geo_long: 7.3 }), raw('Online jazz', 'https://example.org/4')].map(stationFrom);
    for (const station of stations) library.stations.set(station.id, station);
    await library.chooseLocation({ lat: 47.22, lon: -1.55, label: 'Nantes', countrycode: 'FR' });
    assert.deepEqual(library.local().map((s) => s.frequency), [92.1, 101.3]);
    library.setFrequency(stations[3].id, '96.2'); assert.deepEqual(library.local().map((s) => s.frequency), [92.1, 96.2, 101.3]);
    await library.chooseLocation({ lat: 43.7, lon: 7.3, label: 'Nice', countrycode: 'FR' });
    assert.deepEqual(library.local().map((s) => s.frequency), [90]);
});
test('radio next/prev use the local frequency queue even while an online-only station plays', async (t) => {
    const { library } = fixture(t);
    for (const r of [raw('Local FM 101.3', 'https://example.org/1'), raw('Local FM 92.1', 'https://example.org/2'), raw('Internet only', 'https://example.org/3')]) { const s = stationFrom(r); library.stations.set(s.id, s); }
    library.location = { lat: 47.22, lon: -1.55 };
    const player = new RadioPlayer({ library }); t.after(() => player.close());
    const commands = []; player.on('audio', (c) => commands.push(c));
    const online = [...library.stations.values()].find((s) => s.name === 'Internet only');
    player.select(online.id); player.command({ cmd: 'next' }); assert.equal(player.current.frequency, 92.1);
    player.command({ cmd: 'prev' }); assert.equal(player.current.frequency, 101.3); assert.equal(commands.at(-1).tuning, true);
    const old = player.revision;
    player.pause(); assert.equal(player.receive({ id: player.id, revision: old, playing: true }), false);
    player.command({ cmd: 'playPause' }); assert.ok(player.revision > old); assert.equal(player.command({ cmd: 'seek', valueSec: 12 }), false);
    assert.equal(player.state.durationSec, 0); assert.equal(player.state.positionSec, 0);
});
test('recording writes bounded stereo PCM WAV, pause excludes samples, Save copies a finalized file', async (t) => {
    const { directory } = fixture(t); const recorder = new RadioRecorder({ directory });
    recorder.start('Jazz / FM');
    const chunk = new Float32Array([0.5, -0.5, 1, -1]).buffer;
    assert.equal(recorder.chunk(chunk), true); const first = recorder.bytes;
    recorder.togglePause(); assert.equal(recorder.chunk(chunk), false); assert.equal(recorder.bytes, first);
    recorder.togglePause(); recorder.chunk(chunk); assert.equal(recorder.bytes, 16);
    assert.equal(recorder.chunk(new ArrayBuffer(65544)), false);
    const pending = recorder.stop(); const data = fs.readFileSync(pending.file);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF'); assert.equal(data.readUInt32LE(40), 16);
    assert.equal(data.readUInt16LE(22), 2); assert.equal(data.readUInt32LE(24), 48000);
    assert.equal(data.readInt16LE(44), 16384); assert.equal(data.readInt16LE(46), -16384);
    const destination = path.join(directory, 'saved.wav'); await recorder.save(destination);
    assert.equal(recorder.pending, null); assert.equal(fs.existsSync(pending.file), false); assert.equal(fs.statSync(destination).size, 60);
});
