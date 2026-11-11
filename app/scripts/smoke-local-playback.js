// Runs the real desktop entry point against generated audio and isolated settings.
// Never reads the owner's music, modifies login items or produces audible sound.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmamp-desktop-'));
const music = path.join(temporary, 'music');
const userData = path.join(temporary, 'profile');
fs.mkdirSync(music);
fs.mkdirSync(userData);
app.setPath('userData', userData);
app.setLoginItemSettings = () => {};
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
process.env.BRIDGE_TOKEN = 'isolated-local-playback-smoke';
process.env.INTEGRATION_PORT = '24881';
delete process.env.INTEGRATION_HOST;
delete process.env.LASTFM_ENABLED;
delete process.env.LASTFM_API_KEY;
delete process.env.LASTFM_API_SECRET;
delete process.env.LASTFM_SESSION_KEY;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [music] });

function tone(frequency) {
    const rate = 16000;
    const samples = rate * 8;
    const data = Buffer.alloc(44 + samples * 2);
    data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
    data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
    data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
    data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * frequency * 2 * Math.PI / rate) * 14000), 44 + i * 2);
    return data;
}
fs.writeFileSync(path.join(music, '01 first.wav'), tone(440));
fs.writeFileSync(path.join(music, '02 second.wav'), tone(660));
fs.writeFileSync(path.join(music, '03 broken.mp3'), 'not an mp3');

let report;
let finished = false;
ipcMain.on('local-audio-report', (_event, value) => { report = value; });
const deadline = setTimeout(() => finish(new Error('Desktop smoke timed out')), 30000);

function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    console.log(error ? `LOCAL_DESKTOP_SMOKE FAIL: ${error.stack || error}` : 'LOCAL_DESKTOP_SMOKE PASS: folder, decoding, waveform, seek, pause, next, source switch, invalid file, saved folder');
    fs.rmSync(temporary, { recursive: true, force: true });
    app.exit(error ? 1 : 0);
}

async function waitFor(predicate, label) {
    const start = Date.now();
    while (Date.now() - start < 6000) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Timed out: ${label}`);
}

async function run(window) {
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    assert.equal(await evaluate('document.getElementById("source-select").value'), 'local');
    await waitFor(() => evaluate('!document.getElementById("open-folder").disabled'), 'initial library load');
    await evaluate('document.getElementById("open-folder").click()');
    await waitFor(() => evaluate('document.querySelectorAll("#queue-tracks button").length === 3'), 'folder import');
    assert.equal(window.getContentSize()[1], 560);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 700'), true);
    await evaluate('document.querySelector("#queue-tracks button").click()');
    await waitFor(() => report?.playing && report.positionSec > 0.1, 'actual audio playback');
    assert.equal(Math.round(report.durationSec), 8);
    await waitFor(() => evaluate('Array.from(window.readLocalWave()).some(value => value !== 128)'), 'non-silent analyzer data');
    await evaluate('window.electronAPI.sendCommand({v:1,type:"cmd",cmd:"seek",valueSec:3})');
    await waitFor(() => report?.positionSec >= 3, 'seek');
    await evaluate('document.getElementById("play-pause-btn").click()');
    await waitFor(() => report && !report.playing, 'pause');
    const first = report.id;
    await evaluate('document.getElementById("next-btn").click()');
    await waitFor(() => report?.id !== first && report?.playing, 'next');
    await evaluate('window.electronAPI.setSource("ytm")');
    await waitFor(() => evaluate('document.getElementById("source-select").value === "ytm"'), 'YT source');
    await evaluate('window.electronAPI.setSource("local")');
    await waitFor(() => evaluate('document.getElementById("source-select").value === "local" && document.getElementById("play-pause-btn").textContent === "Play"'), 'paused local source');
    await evaluate('document.querySelectorAll("#queue-tracks button")[2].click()');
    await waitFor(() => report?.error && !report.playing, 'invalid file error');
    const settings = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.equal(settings.localFolder, fs.realpathSync(music));
    assert.equal(settings.localTrackId, report.id);
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '../local-playback-smoke.png'), screenshot.toPNG());
    finish();
}

app.on('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => setTimeout(() => run(window).catch(finish), 50));
});
require('../src/main/main');
