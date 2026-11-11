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
    const opened = [];
    const handlers = new Map();
    let bridgeOptions;
    const bounds = { x: 1000, y: 600, width: 360, height: 116 };
    let zoomFactor = 1;
    let visible = true;
    const window = { getBounds: () => ({ ...bounds }),
        isDestroyed: () => false, isVisible: () => visible,
        hide: () => { visible = false; }, show: () => { visible = true; }, focus() {}, setAlwaysOnTop() {},
        setContentSize: (width, height) => Object.assign(bounds, { width, height }),
        setPosition: (x, y) => Object.assign(bounds, { x, y }),
        webContents: { send: (name, value) => messages.push({ name, value }), setZoomFactor: (value) => { zoomFactor = value; } } };
    const electron = {
        shell: { openExternal: async (url) => { opened.push(url); } },
        app: { getPath: () => dir, on() {}, whenReady: () => ({ then() {} }) },
        protocol: { registerSchemesAsPrivileged() {}, handle() {} },
        screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 700 } }) },
        Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
        ipcMain: { on: (name, callback) => handlers.set(name, callback), handle: (name, callback) => handlers.set(name, callback) }
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
    return { context, messages, relayed, opened, handlers, event, bridgeOptions, bounds, zoom: () => zoomFactor, visible: () => visible, directory: dir,
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

test('YouTube source opens the default browser when absent, but never duplicates a connected session', async (t) => {
    const fixture = await appFixture(t);
    fixture.handlers.get('set-source')(fixture.event, 'ytm');
    assert.deepEqual(fixture.opened, ['https://music.youtube.com/']);
    fixture.handlers.get('set-source')(fixture.event, 'local');
    fixture.handlers.get('set-source')(fixture.event, 'ytm');
    assert.equal(fixture.opened.length, 1);
    fixture.bridgeOptions.onMessage({ v: 1, type: 'track', title: 'YT song', artist: 'YT' });
    fixture.bridgeOptions.onMessage({ v: 1, type: 'status', msg: 'Client connected' });
    fixture.handlers.get('open-ytm')(fixture.event);
    assert.equal(fixture.opened.length, 1);
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

test('player scaling persists, fits the display and does not reload audio when the library is collapsed', async (t) => {
    const fixture = await appFixture(t);
    const before = fixture.messages.filter((message) => message.name === 'local-audio-command').length;
    vm.runInContext('setPlayerSize(150)', fixture.context);
    assert.equal(fixture.zoom(), 1.5);
    assert.equal(fixture.bounds.width, 540); assert.equal(fixture.bounds.height, 174);
    fixture.handlers.get('set-queue-visible')(fixture.event, true);
    assert.equal(fixture.bounds.width, 1050); assert.equal(fixture.bounds.height, 700);
    assert.ok(fixture.bounds.x + fixture.bounds.width <= 1200); assert.ok(fixture.bounds.y + fixture.bounds.height <= 700);
    fixture.handlers.get('set-queue-visible')(fixture.event, false);
    vm.runInContext('setPlayerSize(75); setPlayerSize(1)', fixture.context);
    assert.equal(fixture.zoom(), 0.75);
    assert.equal(fixture.bounds.width, 270); assert.equal(fixture.bounds.height, 87);
    assert.equal(JSON.parse(await fs.readFile(path.join(fixture.directory, 'settings.json'), 'utf8')).playerScale, 75);
    assert.equal(fixture.messages.filter((message) => message.name === 'local-audio-command').length, before);
    assert.equal(fixture.snapshot().track.title, 'First');
});

test('hide keeps local audio running; tray restore and YouTube auto-show respect explicit hiding', async (t) => {
    const fixture = await appFixture(t);
    vm.runInContext('localPlayer.receive({id:localPlayer.current.id,revision:localPlayer.revision,positionSec:1,durationSec:100,playing:true})', fixture.context);
    const before = fixture.messages.filter((message) => message.name === 'local-audio-command').length;
    const invalid = { ...fixture.event, senderFrame: { url: 'https://example.com' } };
    fixture.handlers.get('hide-window')(invalid);
    assert.equal(fixture.visible(), true);
    fixture.handlers.get('hide-window')(fixture.event);
    assert.equal(fixture.visible(), false);
    assert.equal(fixture.snapshot().state.playing, true);
    assert.equal(fixture.messages.filter((message) => message.name === 'local-audio-command').length, before);
    vm.runInContext('toggleWindow()', fixture.context);
    assert.equal(fixture.visible(), true);
    fixture.handlers.get('set-source')(fixture.event, 'ytm');
    fixture.handlers.get('hide-window')(fixture.event);
    fixture.bridgeOptions.onMessage({ v: 1, type: 'event', name: 'playingStarted' });
    assert.equal(fixture.visible(), false, 'a new YouTube track does not undo an explicit hide');
    fixture.bridgeOptions.onMessage({ v: 1, type: 'cmd', cmd: 'showWindow' });
    assert.equal(fixture.visible(), true);
});

test('radio stays isolated from inactive sources and untrusted frames; hide preserves the stream', async (t) => {
    const fixture = await appFixture(t);
    vm.runInContext('radioLibrary.stations.set("c".repeat(64), {id:"c".repeat(64),name:"Radio Test",url:"https://example.org/stream",region:"Local",countrycode:"FR",genre:"jazz"})', fixture.context);
    const action = fixture.handlers.get('radio-action');
    const invalid = { ...fixture.event, senderFrame: { url: 'https://example.com' } };
    assert.ok((await action(invalid, 'record', { action: 'start' })).error);
    fixture.handlers.get('set-source')(fixture.event, 'radio');
    assert.equal((await action(fixture.event, 'play', { id: 'c'.repeat(64) })).ok, true);
    vm.runInContext('radioPlayer.receive({id:radioPlayer.id,revision:radioPlayer.revision,playing:true})', fixture.context);
    assert.equal(fixture.snapshot().track.title, 'Radio Test');
    fixture.bridgeOptions.onMessage({ v: 1, type: 'track', title: 'Inactive YouTube', artist: 'YT' });
    assert.equal(fixture.snapshot().track.title, 'Radio Test');
    const before = fixture.messages.filter((m) => m.name === 'radio-audio-command').length;
    fixture.handlers.get('hide-window')(fixture.event);
    assert.equal(fixture.snapshot().state.playing, true);
    assert.equal(fixture.messages.filter((m) => m.name === 'radio-audio-command').length, before);
    fixture.handlers.get('set-source')(fixture.event, 'local');
    assert.equal(fixture.messages.filter((m) => m.name === 'radio-audio-command').at(-1).value.action, 'pause');
    assert.equal(fixture.snapshot().track.title, 'First');
    assert.equal(fixture.snapshot().state.playing, false);
});
