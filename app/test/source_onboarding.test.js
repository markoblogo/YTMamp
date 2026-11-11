const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createYtmLauncher } = require('../src/main/ytm_launcher');
const { locateMac } = require('../src/main/device_location');
test('YouTube opens the default browser only when disconnected and avoids repeated opens', async () => {
    const opened = []; let now = 1000;
    const launch = createYtmLauncher({ openExternal: async (url) => opened.push(url), now: () => now });
    assert.equal(await launch({ connected: true }), false);
    assert.equal(await launch(), true); assert.deepEqual(opened, ['https://music.youtube.com/']);
    assert.equal(await launch(), false); now += 31000; assert.equal(await launch(), true);
    assert.equal(await launch({ force: true }), true);
});
test('native location returns rounded coordinates and OS-derived country, without a browser provider', async () => {
    let request;
    const result = await locateMac({ packaged: true, resourcesPath: '/app/Resources', execute: (file, args, options, callback) => {
        request = { file, args, options };
        callback(null, JSON.stringify({ lat: 47.21682, lon: -1.55413, label: 'Nantes', countrycode: 'fr' }));
    } });
    assert.equal(request.file, path.join('/app/Resources', 'native/ytmamp-location')); assert.deepEqual(request.args, []);
    assert.ok(request.options.timeout <= 30000); assert.equal(result.lat, 47.22); assert.equal(result.lon, -1.55); assert.equal(result.countrycode, 'FR');
});
test('native permission denial and invalid coordinates remain actionable errors', async () => {
    await assert.rejects(locateMac({ appPath: '/app', execute: (_f, _a, _o, cb) => cb(null, JSON.stringify({ error: 'Allow YTMamp in Location Services.' })) }), /Location Services/);
    await assert.rejects(locateMac({ appPath: '/app', execute: (_f, _a, _o, cb) => cb(null, JSON.stringify({ lat: 999, lon: 2 })) }), /invalid location/);
});
