const assert = require('assert');
const test = require('node:test');
const {
    assertSafeIntegrationConfig,
    getCastCorsHeaders,
    isAuthorizedRequest
} = require('../src/main/integration_security');

test('allows a tokenless integration API only on loopback', () => {
    assert.deepEqual(
        assertSafeIntegrationConfig({ host: '127.0.0.1', token: '' }),
        { lanEnabled: false }
    );
    assert.throws(
        () => assertSafeIntegrationConfig({ host: '0.0.0.0', token: '' }),
        /INTEGRATION_TOKEN/
    );
    assert.deepEqual(
        assertSafeIntegrationConfig({ host: '0.0.0.0', token: 'shared-secret' }),
        { lanEnabled: true }
    );
});

test('requires the configured integration token for every API route', () => {
    const request = {
        headers: {
            authorization: 'Bearer shared-secret'
        }
    };
    assert.equal(isAuthorizedRequest(request, '', 'shared-secret'), true);
    assert.equal(isAuthorizedRequest(request, '', 'wrong-secret'), false);
    assert.equal(isAuthorizedRequest({ headers: {} }, '', 'shared-secret'), false);
    assert.equal(isAuthorizedRequest({ headers: {} }, '', ''), true);
});

test('emits cast CORS headers only for explicitly allowed browser origins', () => {
    assert.deepEqual(getCastCorsHeaders('', []), {});
    assert.equal(getCastCorsHeaders('https://evil.example', ['https://controller.example']), null);
    assert.equal(getCastCorsHeaders('https://controller.example', ['*']), null);
    assert.deepEqual(
        getCastCorsHeaders('https://controller.example', ['https://controller.example']),
        {
            'access-control-allow-origin': 'https://controller.example',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': 'Authorization, Content-Type, X-YTMAMP-Token',
            vary: 'Origin'
        }
    );
});
