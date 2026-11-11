const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

async function appFixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytmamp-routing-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const filename = path.resolve(__dirname, '../src/main/main.js');
    const requireFromMain = createRequire(filename);
    const messages = [];
    const relayed = [];
    const handlers = new Map();
    let bridgeOptions;
    const window = { webContents: { send: (name, value) => messages.push({ name, value }) } };
    const electron = {
        app: { getPath: () => dir, on() {}, whenReady: () => ({ then() {} }) },
        protocol: { registerSchemesAsPrivileged() {}, handle() {} },
        ipcMain: { on: (name, callback) => handlers.set(name, callback) }
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        process, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
        __dirname: path.dirname(filename), testWindow: window,
        require: (name) => {
            if (name === 'electron') return electron;
            if (name === './ws_bridge') return {
                ...requireFromMain(name), createBridgeServer: (options) => {
                    bridgeOptions = options;
                    return { start() {}, relayCommand: (command) => { relayed.push(command); return true; } };
                }
            };
            return requireFromMain(name);
        }
    });
    vm.runInContext(await fs.readFile(filename, 'utf8'), context, { filename });
    vm.runInContext('mainWindow = testWindow; setupLocalPlayback(); setupIpc(); setupWebSocket();', context);
    const event = { sender: window.webContents,
        senderFrame: { url: pathToFileURL(path.resolve(__dirname, '../src/renderer/index.html')).href } };
    context.testLibrary = { root: dir, name: 'Music', tracks: [
        { id: 'a'.repeat(64), title: 'First', artist: 'Music', relativePath: 'first.wav', filePath: path.join(dir, 'first.wav') },
        { id: 'b'.repeat(64), title: 'Second', artist: 'Music', relativePath: 'second.wav', filePath: path.join(dir, 'second.wav') }
    ] };
    vm.runInContext('localPlayer.setLibrary(testLibrary);', context);
    return { context, messages, relayed, handlers, event, bridgeOptions,
        snapshot: () => JSON.parse(vm.runInContext('JSON.stringify({ source: activeSource, track: playerState.track, state: playerState.state })', context)) };
}

test('desktop starts local, routes controls locally and ignores inactive YouTube metadata', async (t) => {
    const fixture = await appFixture(t);
    assert.equal(fixture.snapshot().source, 'local');
    fixture.bridgeOptions.onMessage({ v: 1, type: 'track', title: 'YouTube song', artist: 'YT artist' });
    fixture.bridgeOptions.onMessage({ v: 1, type: 'state', playing: true, positionSec: 4, durationSec: 50 });
    assert.equal(fixture.snapshot().track.title, 'First');
    fixture.handlers.get('send-command')(fixture.event, { v: 1, type: 'cmd', cmd: 'next' });
    assert.equal(fixture.snapshot().track.title, 'Second');
    assert.equal(fixture.relayed.length, 0);
    assert.equal(fixture.messages.filter((message) => message.name === 'local-audio-command').at(-1).value.autoplay, true);
});

test('source switching pauses outgoing local audio and sends an idempotent YouTube pause', async (t) => {
    const fixture = await appFixture(t);
    fixture.bridgeOptions.onMessage({ v: 1, type: 'track', title: 'YouTube song', artist: 'YT artist' });
    fixture.bridgeOptions.onMessage({ v: 1, type: 'state', playing: true, positionSec: 4, durationSec: 50 });
    fixture.handlers.get('set-source')(fixture.event, 'ytm');
    assert.equal(fixture.snapshot().track.title, 'YouTube song');
    assert.equal(fixture.messages.filter((message) => message.name === 'local-audio-command').at(-1).value.action, 'pause');
    fixture.handlers.get('set-source')(fixture.event, 'local');
    assert.equal(fixture.relayed.at(-1).cmd, 'pause');
    assert.equal(fixture.snapshot().track.title, 'First');
    assert.equal(fixture.snapshot().state.playing, false);
});

test('untrusted renderer frames cannot select folders, switch source or control playback', async (t) => {
    const fixture = await appFixture(t);
    const invalid = { ...fixture.event, senderFrame: { url: 'https://example.com' } };
    fixture.handlers.get('set-source')(invalid, 'ytm');
    fixture.handlers.get('send-command')(invalid, { v: 1, type: 'cmd', cmd: 'next' });
    fixture.handlers.get('select-local-track')(invalid, 'b'.repeat(64));
    assert.equal(fixture.snapshot().source, 'local');
    assert.equal(fixture.snapshot().track.title, 'First');
});
