const assert = require('assert');
const test = require('node:test');
const {
    INTEGRATION_API_VERSION,
    getRequestedIntegrationApiVersion,
    isSupportedIntegrationApiVersion,
    validateCanonicalPayload,
    validateIntegrationEventEnvelope
} = require('../src/main/integration_api_contract');

test('returns default API version when no negotiation headers are provided', () => {
    const version = getRequestedIntegrationApiVersion(new URLSearchParams(), {});
    assert.equal(version, INTEGRATION_API_VERSION);
});

test('parses API version from query/header override', () => {
    const versionFromQuery = getRequestedIntegrationApiVersion(new URLSearchParams('api_version=1'), {});
    const versionFromHeader = getRequestedIntegrationApiVersion(new URLSearchParams(), {
        'x-ytmamp-api-version': '1'
    });
    assert.equal(versionFromQuery, INTEGRATION_API_VERSION);
    assert.equal(versionFromHeader, INTEGRATION_API_VERSION);
});

test('rejects unsupported API versions', () => {
    assert.equal(isSupportedIntegrationApiVersion(99), false);
    assert.equal(isSupportedIntegrationApiVersion(-1), false);
    assert.equal(isSupportedIntegrationApiVersion(undefined), false);
});

test('validates canonical status/current-track payload', () => {
    const payload = {
        v: INTEGRATION_API_VERSION,
        status: 'CONNECTED',
        track: { title: 'Test' },
        state: { playing: true },
        updatedAt: 1700000000,
        windowVisible: true
    };
    assert.equal(validateCanonicalPayload(payload), true);
    assert.equal(validateCanonicalPayload({ ...payload, track: [] }), false);
});

test('validates SSE event envelope', () => {
    const envelope = {
        type: 'track',
        v: INTEGRATION_API_VERSION,
        payload: { title: 'x' }
    };
    assert.equal(validateIntegrationEventEnvelope(envelope), true);
    assert.equal(validateIntegrationEventEnvelope({ type: 'track', v: 99, payload: {} }), false);
});

