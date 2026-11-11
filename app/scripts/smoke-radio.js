const { app, dialog, ipcMain } = require('electron');
require('electron').shell.openExternal = async () => {};
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { taggedWav } = require('./audio-fixture');
const { RadioLibrary } = require('../src/main/radio_library');
const network = require('../src/main/radio_network');
require('../src/main/device_location').locateMac = async () => ({ lat: 47.22, lon: -1.55, label: 'Test location', countrycode: 'FR' });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmamp-radio-desktop-'));
const output = path.join(temporary, 'recorded.wav');
app.setPath('userData', temporary); app.setLoginItemSettings = () => {};
app.commandLine.appendSwitch('mute-audio'); app.disableHardwareAcceleration();
process.env.BRIDGE_TOKEN = 'isolated-radio-smoke'; process.env.INTEGRATION_PORT = '24883';
for (const key of ['INTEGRATION_HOST', 'LASTFM_ENABLED', 'LASTFM_API_KEY', 'LASTFM_API_SECRET', 'LASTFM_SESSION_KEY']) delete process.env[key];
const first = { name: 'Test Jazz 92.1 FM', url: 'https://radio.example.org/first', tags: 'jazz', countrycode: 'FR', language: 'French', state: 'Nantes', geo_lat: 47.22, geo_long: -1.55 };
const second = { ...first, name: 'Test Rock FM 101.3', url: 'https://radio.example.org/second', tags: 'rock' };
const online = { ...first, name: 'Internet Only', url: 'https://radio.example.org/online', geo_lat: null, geo_long: null };
network.RadioBrowser.prototype.search = async () => [first, second, online];
network.RadioBrowser.prototype.click = () => {};
const wav = taggedWav({ seconds: 60, frequency: 440 });
// Stub only the exported transport in this test process. Production has no LAN bypass.
network.createRadioMediaHandler = () => async () => new Response(wav, { headers: { 'content-type': 'audio/wav', 'access-control-allow-origin': '*' } });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
let report; let record; let finished = false;
ipcMain.on('radio-audio-report', (_event, value) => { report = value; });
ipcMain.on('radio-record-chunk', (_event, value) => { record = value; });
const deadline = setTimeout(() => finish(new Error('Radio desktop smoke timed out')), 60000);
function finish(error) {
    if (finished) return; finished = true; clearTimeout(deadline);
    console.log(error ? 'RADIO_DESKTOP_SMOKE FAIL: ' + (error.stack || error) : 'RADIO_DESKTOP_SMOKE PASS: source, cards/search, local-only frequency queue, waveform, hide, recording pause/resume, PCM WAV save and source exclusivity');
    fs.rmSync(temporary, { recursive: true, force: true }); app.exit(error ? 1 : 0);
}
async function waitFor(predicate, label) {
    const started = Date.now();
    while (Date.now() - started < 10000) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 40)); }
    throw new Error('Timed out: ' + label);
}
async function run(window) {
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    const action = (name, data = {}) => evaluate('window.electronAPI.radio(' + JSON.stringify(name) + ',' + JSON.stringify(data) + ')');
    assert.equal(await evaluate('document.getElementById("source-select").value'), 'local');
    await evaluate('window.electronAPI.setSource("radio")');
    await waitFor(() => evaluate('document.body.classList.contains("radio-mode")'), 'radio source');
    await evaluate('document.getElementById("queue-toggle").click(); document.getElementById("radio-search-form").requestSubmit()');
    await waitFor(() => evaluate('document.querySelectorAll("#radio-grid .album-card").length === 3'), 'radio cards');
    assert.equal(await evaluate('document.getElementById("radio-country") === null && document.getElementById("radio-city") === null'), true);
    await action('location', { lat: 47.22, lon: -1.55, label: 'Nantes', countrycode: 'FR' });
    await evaluate('document.getElementById("radio-local").click()');
    await waitFor(() => evaluate('document.querySelectorAll("#radio-grid .album-card").length === 2'), 'local frequency cards');
    assert.equal(await evaluate('document.querySelector(".radio-mhz").textContent'), '92.1 MHz');
    await evaluate('document.querySelector("#radio-grid .album-card").click()');
    await waitFor(() => report?.playing, 'radio audio');
    await waitFor(() => evaluate('window.canRecordRadio() && [...window.readRadioWave()].some(v => v !== 128)'), 'radio analyzer');
    const id = report.id;
    await evaluate('document.getElementById("next-btn").click()');
    await waitFor(() => report?.playing && report.id !== id, 'next local station');
    assert.equal(await evaluate('document.getElementById("radio-frequency").textContent.startsWith("101.3 MHz")'), true);
    const stationAt101 = report.id;
    await evaluate('document.getElementById("prev-btn").click()');
    await waitFor(() => evaluate('document.getElementById("radio-frequency").textContent.includes("SEEK")'), 'animated seek starts');
    await evaluate('document.getElementById("next-btn").click()');
    await waitFor(() => report?.playing && report.id === stationAt101, 'new seek supersedes old seek');
    assert.equal(await evaluate('document.getElementById("radio-frequency").textContent.startsWith("101.3 MHz")'), true);
    await evaluate('document.getElementById("radio-record").click()');
    await waitFor(() => record?.byteLength > 0, 'PCM worklet recording');
    const bytesBefore = fs.statSync(fs.readdirSync(temporary).filter((name) => /^radio-recording-[a-f0-9]{24}\.wav$/.test(name)).map((name) => path.join(temporary, name))[0]).size;
    assert.ok(bytesBefore > 44);
    await evaluate('document.getElementById("radio-record-pause").click()');
    await waitFor(() => evaluate('document.getElementById("radio-record-pause").textContent === "REC"'), 'pause recording');
    const temporaryRecording = fs.readdirSync(temporary).find((name) => /^radio-recording-[a-f0-9]{24}\.wav$/.test(name));
    const pausedBytes = fs.statSync(path.join(temporary, temporaryRecording)).size;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fs.statSync(path.join(temporary, temporaryRecording)).size, pausedBytes);
    assert.equal(report.playing, true);
    await evaluate('document.getElementById("radio-record-pause").click()');
    await waitFor(() => fs.statSync(path.join(temporary, temporaryRecording)).size > pausedBytes, 'resume recording');
    await evaluate('document.getElementById("radio-record-stop").click()');
    await waitFor(async () => fs.existsSync(output) && await evaluate('document.getElementById("radio-record-status").textContent === "Recording saved."'), 'completed WAV save');
    const recorded = fs.readFileSync(output);
    assert.equal(recorded.readUInt32LE(40), recorded.length - 44); assert.equal(recorded.readUInt32LE(24), 48000);
    assert.ok(recorded.subarray(44).some((v) => v !== 0), 'saved WAV has audible PCM samples');
    await evaluate('document.getElementById("radio-collapse").click()');
    assert.equal(await evaluate('document.getElementById("radio-library").hidden'), true);
    await evaluate('document.getElementById("hide-btn").click()');
    await waitFor(() => !window.isVisible(), 'hide while radio plays');
    assert.equal(report.playing, true); window.show();
    // Compact radio controls and frequency strip must fit at every scale.
    for (const factor of [0.75, 1, 1.25, 1.5]) {
        window.webContents.setZoomFactor(factor); window.setContentSize(Math.round(360 * factor), Math.round(116 * factor));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const fit = await evaluate('(()=>{const root=document.getElementById("container").getBoundingClientRect();return ["radio-dial","radio-record-stop","volume-slider","close-btn"].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>0&&r.right<=root.right+1&&r.bottom<=root.bottom+1;});})()');
        assert.equal(fit, true, 'compact radio fit at ' + factor);
    }
    window.webContents.setZoomFactor(1); window.setContentSize(360, 116);
    fs.writeFileSync(path.join(__dirname, '../radio-smoke.png'), (await window.webContents.capturePage()).toPNG());
    await evaluate('window.electronAPI.setSource("local")');
    await waitFor(() => evaluate('!document.body.classList.contains("radio-mode")'), 'back to local');
    assert.equal(await evaluate('window.readRadioWave() === null'), true);
    const library = new RadioLibrary({ directory: temporary }); assert.equal(library.local().length, 2);
    finish();
}
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => setTimeout(() => run(window).catch(finish), 80)));
require('../src/main/main');
