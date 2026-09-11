const crypto = require('crypto');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function assertSafeIntegrationConfig({ host, token }) {
    const normalizedHost = String(host || '').trim().toLowerCase();
    const lanEnabled = !LOOPBACK_HOSTS.has(normalizedHost);
    if (lanEnabled && !String(token || '').trim()) {
        throw new Error('INTEGRATION_TOKEN is required when INTEGRATION_HOST is not loopback');
    }
    return { lanEnabled };
}

function secureEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedRequest(req, queryToken, expectedToken) {
    const configuredToken = String(expectedToken || '').trim();
    if (!configuredToken) return true;
    const headers = (req && req.headers) || {};
    const headerToken = String(headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const xToken = String(headers['x-ytmamp-token'] || '').trim();
    const suppliedToken = String(queryToken || headerToken || xToken).trim();
    return secureEqual(suppliedToken, configuredToken);
}

function parseOriginAllowlist(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function getCastCorsHeaders(origin, allowlist) {
    const normalizedOrigin = String(origin || '').trim();
    if (!normalizedOrigin) return {};
    if (!allowlist.includes(normalizedOrigin)) return null;
    return {
        'access-control-allow-origin': normalizedOrigin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'Authorization, Content-Type, X-YTMAMP-Token',
        vary: 'Origin'
    };
}

module.exports = {
    assertSafeIntegrationConfig,
    getCastCorsHeaders,
    isAuthorizedRequest,
    parseOriginAllowlist
};
