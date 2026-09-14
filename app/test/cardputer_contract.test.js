const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const contract = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'cardputer-contract.v1.json'),
    'utf8'
));
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

test('Cardputer contract matches the implemented cast API', () => {
    assert.equal(contract.api_version, 1);
    assert.equal(contract.security.token_header, 'X-YTMAMP-Token');
    assert.match(main, /parsedUrl\.pathname === '\/api\/cast\/status'/);
    assert.match(main, /parsedUrl\.pathname === '\/api\/cast\/cmd'/);
    for (const action of contract.command_endpoint.actions) {
        assert.match(main, new RegExp(`['"]${action}['"]`));
    }
});
