const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

test('development sample plugins are disabled in release builds', () => {
    const pluginsDir = path.join(__dirname, '../plugins');
    const manifests = fs.readdirSync(pluginsDir).filter((name) => name.endsWith('.plugin.json'));

    assert.ok(manifests.length > 0);
    for (const name of manifests) {
        const manifest = JSON.parse(fs.readFileSync(path.join(pluginsDir, name), 'utf8'));
        assert.equal(manifest.enabled, false, `${name} must not create development UI for users`);
    }
});
