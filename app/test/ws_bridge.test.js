const assert = require('assert');
const test = require('node:test');
const WebSocket = require('ws');
const { createBridgeServer, sanitizeTrackMessage, validateMessage } = require('../src/main/ws_bridge');

function once(target, event) {
    return new Promise((resolve) => target.once(event, resolve));
}

test('validates known commands and rejects malformed payloads', () => {
    assert.equal(validateMessage({ type: 'cmd', v: 1, cmd: 'like' }), true);
    assert.equal(validateMessage({ type: 'cmd', v: 1, cmd: 'seek', valueSec: 12 }), true);
    assert.equal(validateMessage({ type: 'cmd', v: 1, cmd: 'seek', valueSec: -1 }), false);
    assert.equal(validateMessage({ type: 'cmd', v: 1, cmd: 'evil' }), false);
    assert.equal(validateMessage({ type: 'track', v: 2, title: 'x' }), false);
});

test('sanitizes track metadata before renderer IPC', () => {
    const longTitle = `  ${'A'.repeat(400)}  `;
    const msg = sanitizeTrackMessage({ type: 'track', v: 1, title: longTitle, artist: 123 });

    assert.equal(msg.title.length, 300);
    assert.equal(msg.artist, 'Unknown Artist');
});

test('relays renderer command to active websocket client and cleans up on close', async () => {
    const bridge = createBridgeServer({ port: 0 });
    const server = bridge.start();
    await once(server, 'listening');
    const { port } = server.address();
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(client, 'open');

    const received = once(client, 'message');
    assert.equal(bridge.relayCommand({ type: 'cmd', v: 1, cmd: 'repeat', id: 7 }), true);
    assert.deepEqual(JSON.parse((await received).toString()), { type: 'cmd', v: 1, cmd: 'repeat', id: 7 });

    client.close();
    await once(client, 'close');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(bridge.relayCommand({ type: 'cmd', v: 1, cmd: 'repeat' }), false);
    bridge.stop();
});
