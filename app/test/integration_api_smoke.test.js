const assert = require('assert');
const http = require('http');
const test = require('node:test');
const {
    INTEGRATION_API_VERSION,
    getRequestedIntegrationApiVersion,
    isSupportedIntegrationApiVersion,
    validateCanonicalPayload,
    validateIntegrationEventEnvelope
} = require('../src/main/integration_api_contract');

function parseCsvAllowlist(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function isObsOriginAllowed(origin, allowlist) {
    const normalized = typeof origin === 'string' ? origin.trim() : '';
    if (!normalized) return true;
    if (!allowlist.length) return false;
    if (allowlist.includes('*')) return true;
    return allowlist.includes(normalized);
}

function createSmokeIntegrationServer({ integrationToken = '', isLocalRequest: overrideIsLocalRequest = null, obsOriginAllowlist = [] } = {}) {
    const INTEGRATION_HOST = '127.0.0.1';
    const INTEGRATION_PORT = 18990;
    const MAX_SSE_CLIENTS = 2;
    const RATE_LIMIT_WINDOW_MS = 1000;
    const RATE_LIMIT_MAX_REQUESTS = 3;

    let track = null;
    let state = null;
    let lastTs = 0;
    let appStatus = 'OFFLINE';
    const obsAllowlist = parseCsvAllowlist(obsOriginAllowlist);
    const sseClients = new Set();
    const integrationRateBuckets = new Map();

    function appPayload() {
        return {
            v: INTEGRATION_API_VERSION,
            status: appStatus,
            track,
            state,
            updatedAt: lastTs || 0,
            windowVisible: false
        };
    }

    const integrationHeaders = {
        'x-ytmamp-api-version': String(INTEGRATION_API_VERSION)
    };
    const isLocalRequest = overrideIsLocalRequest || ((req) => {
        const raw = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
        const ip = raw === '::1' ? '127.0.0.1' : (raw.startsWith('::ffff:') ? raw.replace('::ffff:', '') : raw);
        return ip === '127.0.0.1' || ip === '::1';
    });

    function isAuthorized(req, queryToken) {
        if (!integrationToken) return true;
        const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        const xToken = (req.headers['x-ytmamp-token'] || '').trim();
        const token = queryToken || headerToken || xToken;
        return token === integrationToken;
    }

    function getRateBucket(ip) {
        const now = Date.now();
        const bucket = integrationRateBuckets.get(ip) || { count: 0, start: now };
        if (now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
            bucket.count = 0;
            bucket.start = now;
        }
        bucket.count++;
        integrationRateBuckets.set(ip, bucket);
        return bucket;
    }

    function getRetryAfterMs(bucket) {
        const elapsed = Date.now() - bucket.start;
        return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000));
    }

    function writePayloadResponse(res, statusCode, payload, extraHeaders = {}) {
        if (!validateCanonicalPayload(payload)) {
            res.writeHead(500, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                'x-ytmamp-api-version': String(INTEGRATION_API_VERSION)
            });
            res.end(JSON.stringify({
                v: INTEGRATION_API_VERSION,
                error: 'INVALID_CANONICAL_PAYLOAD'
            }));
            return;
        }

        const json = JSON.stringify(payload);
        res.writeHead(statusCode, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-ytmamp-api-version': String(INTEGRATION_API_VERSION),
            ...extraHeaders,
            'content-length': Buffer.byteLength(json)
        });
        res.end(json);
    }

    function writeJsonResponse(res, statusCode, payload, extraHeaders = {}) {
        const json = JSON.stringify(payload);
        res.writeHead(statusCode, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            ...extraHeaders,
            'content-length': Buffer.byteLength(json)
        });
        res.end(json);
    }

    function writeSseEvent(res, payload) {
        if (!validateIntegrationEventEnvelope(payload)) return;
        const body = JSON.stringify(payload);
        res.write(`event: ${payload.type}\ndata: ${body}\n\n`);
    }

    const server = http.createServer((req, res) => {
        if (!req.url) {
            res.writeHead(400, integrationHeaders);
            res.end('bad request');
            return;
        }

        if (!isLocalRequest(req)) {
            res.writeHead(403, {
                ...integrationHeaders,
                'content-type': 'text/plain; charset=utf-8'
            });
            res.end('forbidden');
            return;
        }

        const parsedUrl = new URL(req.url, `http://${INTEGRATION_HOST}:${INTEGRATION_PORT}`);
        const query = parsedUrl.searchParams;
        const token = query.get('token');
        const apiVersion = getRequestedIntegrationApiVersion(query, req.headers);
        const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';

        if (!isSupportedIntegrationApiVersion(apiVersion)) {
            res.writeHead(400, {
                ...integrationHeaders,
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                'x-ytmamp-api-version': String(INTEGRATION_API_VERSION)
            });
            res.end(JSON.stringify({
                v: INTEGRATION_API_VERSION,
                error: 'UNSUPPORTED_API_VERSION',
                requested: apiVersion,
                supported: [INTEGRATION_API_VERSION]
            }));
            return;
        }

        if (!isAuthorized(req, token)) {
            res.writeHead(401, {
                ...integrationHeaders,
                'www-authenticate': 'Bearer realm="ytmamp-local"',
                'content-type': 'text/plain; charset=utf-8'
            });
            res.end('unauthorized');
            return;
        }

        const ip = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '127.0.0.1';
        const bucket = getRateBucket(ip);
        if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
            res.writeHead(429, {
                ...integrationHeaders,
                'content-type': 'text/plain; charset=utf-8',
                'retry-after': String(getRetryAfterMs(bucket))
            });
            res.end('rate limit exceeded');
            return;
        }

        if (req.method === 'GET' && parsedUrl.pathname === '/status') {
            writePayloadResponse(res, 200, appPayload());
            return;
        }

        if (parsedUrl.pathname === '/obs' && req.method === 'OPTIONS') {
            if (!isObsOriginAllowed(requestOrigin, obsAllowlist)) {
                res.writeHead(403, {
                    ...integrationHeaders,
                    'content-type': 'text/plain; charset=utf-8'
                });
                res.end('forbidden');
                return;
            }

            res.writeHead(204, {
                ...integrationHeaders,
                'access-control-allow-origin': requestOrigin,
                'access-control-allow-methods': 'GET, OPTIONS',
                'access-control-allow-headers': 'Authorization, X-YTMAMP-Token, Content-Type',
                'access-control-max-age': '300'
            });
            res.end();
            return;
        }

        if (parsedUrl.pathname === '/obs' && req.method === 'GET') {
            if (!isObsOriginAllowed(requestOrigin, obsAllowlist)) {
                res.writeHead(403, {
                    ...integrationHeaders,
                    'content-type': 'text/plain; charset=utf-8'
                });
                res.end('forbidden');
                return;
            }

            if (!track) {
                res.writeHead(204, {
                    ...integrationHeaders,
                    'cache-control': 'no-store'
                });
                res.end();
                return;
            }

            const payload = {
                title: typeof track.title === 'string' ? track.title : '',
                artist: typeof track.artist === 'string' ? track.artist : '',
                cover: typeof track.cover === 'string' ? track.cover : '',
                position: state && Number.isFinite(state.positionSec) ? Math.floor(state.positionSec) : 0,
                likes: Number.isFinite(track.likes) ? track.likes : null
            };
            writeJsonResponse(res, 200, payload, {
                ...integrationHeaders,
                'access-control-allow-origin': requestOrigin
            });
            return;
        }

        if (req.method === 'GET' && parsedUrl.pathname === '/current-track') {
            if (!track) {
                res.writeHead(204, {
                    ...integrationHeaders,
                    'cache-control': 'no-store'
                });
                res.end();
                return;
            }

            writePayloadResponse(res, 200, appPayload());
            return;
        }

            if (req.method === 'GET' && parsedUrl.pathname === '/events') {
                if (sseClients.size >= MAX_SSE_CLIENTS) {
                    res.writeHead(429, {
                        ...integrationHeaders,
                        'content-type': 'text/plain; charset=utf-8',
                        'retry-after': '1'
                    });
                    res.end('too many SSE clients');
                    return;
                }

                res.writeHead(200, {
                    ...integrationHeaders,
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-store',
                    connection: 'keep-alive'
                });
            res.write(': connected\n\n');
            writeSseEvent(res, {
                type: 'snapshot',
                v: INTEGRATION_API_VERSION,
                payload: appPayload()
            });

            sseClients.add(res);
            const onClose = () => {
                sseClients.delete(res);
            };
            req.on('close', onClose);
            req.on('aborted', onClose);
            return;
        }

        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
    });

    function setTrack(value) {
        track = value;
        state = { playing: Boolean(value) };
        lastTs = Date.now();
    }

    function setState(value) {
        state = value;
        lastTs = Date.now();
    }

    function setStatus(value) {
        appStatus = value;
    }

    return {
        server,
        INTEGRATION_HOST,
        INTEGRATION_PORT,
        setTrack,
        setStatus,
        setState
    };
}

async function requestStatus({ serverUrl, headers = {}, path = '/status' }) {
    return await new Promise((resolve, reject) => {
        const req = http.request(`${serverUrl}${path}`, {
            method: 'GET',
            headers
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

test('returns 200 /status with current API version and contract headers', async () => {
    const fixture = createSmokeIntegrationServer({ integrationToken: 'test-token' });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        const response = await requestStatus({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            headers: { Authorization: 'Bearer test-token' },
            path: '/status'
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));

        const data = JSON.parse(response.body);
        assert.equal(validateCanonicalPayload(data), true);
    } finally {
        await closeServer(fixture.server);
    }
});

async function requestStatusRaw({ serverUrl, path = '/status', headers = {}, method = 'GET' }) {
    return await new Promise((resolve, reject) => {
        const req = http.request(`${serverUrl}${path}`, {
            method,
            headers
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

test('returns 204 for /current-track when absent and 200 when present', async () => {
    const fixture = createSmokeIntegrationServer();
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        let response = await requestStatus({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/current-track'
        });
        assert.equal(response.statusCode, 204);

        fixture.setTrack({ title: 'Track A', artist: 'Artist' });
        response = await requestStatus({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/current-track'
        });
        assert.equal(response.statusCode, 200);

        const data = JSON.parse(response.body);
        assert.equal(data.track.title, 'Track A');
    } finally {
        await closeServer(fixture.server);
    }
});

test('returns 401 when token mismatch and 400 for unsupported version', async () => {
    const fixture = createSmokeIntegrationServer({ integrationToken: 'test-token' });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        let response = await requestStatus({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/status?token=wrong'
        });
        assert.equal(response.statusCode, 401);
        assert.equal(response.headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));

        response = await requestStatus({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/status?api_version=99'
        });
        assert.equal(response.statusCode, 400);
        assert.equal(response.headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));
        const payload = JSON.parse(response.body);
        assert.equal(payload.error, 'UNSUPPORTED_API_VERSION');
    } finally {
        await closeServer(fixture.server);
    }
});

test('returns 403 for /events from non-local source', async () => {
    const fixture = createSmokeIntegrationServer({
        integrationToken: 'test-token',
        isLocalRequest: () => false
    });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        const response = await requestStatus({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/events?token=test-token'
        });
        assert.equal(response.statusCode, 403);
        assert.equal(response.headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));
    } finally {
        await closeServer(fixture.server);
    }
});

test('applies rate limiting with 429', async () => {
    const fixture = createSmokeIntegrationServer();
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        let response;
        for (let i = 0; i < 3; i += 1) {
            response = await requestStatus({
                serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
                path: '/status'
            });
            assert.equal(response.statusCode, 200);
        }

        response = await requestStatus({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/status'
        });
        assert.equal(response.statusCode, 429);
        assert.equal(response.headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));
    } finally {
        await closeServer(fixture.server);
    }
});

test('streams snapshot on SSE events endpoint and exposes contract version header', async () => {
    const fixture = createSmokeIntegrationServer({ integrationToken: 'test-token' });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        const { statusCode, headers } = await new Promise((resolve, reject) => {
            const req = http.request(`http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}/events?token=test-token`, (res) => {
                let body = '';
                let done = false;
                const timer = setTimeout(() => {
                    if (!done) {
                        done = true;
                        res.destroy();
                        reject(new Error('SSE timeout'));
                    }
                }, 2000);

                res.on('data', (chunk) => {
                    body += chunk.toString();
                    if (!done && body.includes('event: snapshot')) {
                        done = true;
                        clearTimeout(timer);
                        res.destroy();
                        resolve({ statusCode: res.statusCode, headers: res.headers, body });
                    }
                });
                res.on('error', (error) => {
                    if (!done) {
                        done = true;
                        clearTimeout(timer);
                        reject(error);
                    }
                });
            });
            req.on('error', (error) => {
                reject(error);
            });
            req.end();
        });

        assert.equal(statusCode, 200);
        assert.ok((headers['content-type'] || '').includes('text/event-stream'));
        assert.equal(headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));
        assert.ok(body.includes('event: snapshot'));
    } finally {
        await closeServer(fixture.server);
    }
});

test('returns minimal OBS overlay payload for allowed origin', async () => {
    const fixture = createSmokeIntegrationServer({ obsOriginAllowlist: ['http://obs.client'] });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        fixture.setTrack({
            title: 'Track B',
            artist: 'Artist B',
            cover: 'https://cdn.example.com/cover.jpg',
            likes: 77
        });
        fixture.setState({
            positionSec: 12.7,
            durationSec: 180,
            playing: true
        });

        const response = await requestStatusRaw({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/obs',
            headers: {
                Origin: 'http://obs.client'
            }
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['access-control-allow-origin'], 'http://obs.client');
        assert.equal(response.headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));

        const data = JSON.parse(response.body);
        assert.deepEqual(Object.keys(data).sort(), ['artist', 'cover', 'likes', 'position', 'title']);
        assert.equal(data.title, 'Track B');
        assert.equal(data.artist, 'Artist B');
        assert.equal(data.cover, 'https://cdn.example.com/cover.jpg');
        assert.equal(data.position, 12);
        assert.equal(data.likes, 77);
    } finally {
        await closeServer(fixture.server);
    }
});

test('returns 403 for disallowed OBS overlay origin', async () => {
    const fixture = createSmokeIntegrationServer({ obsOriginAllowlist: ['http://allowed.client'] });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        const response = await requestStatusRaw({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/obs',
            headers: {
                Origin: 'http://evil.client'
            }
        });
        assert.equal(response.statusCode, 403);
        assert.equal(response.headers['x-ytmamp-api-version'], String(INTEGRATION_API_VERSION));
    } finally {
        await closeServer(fixture.server);
    }
});

test('returns 204 for OBS overlay when track is absent', async () => {
    const fixture = createSmokeIntegrationServer({ obsOriginAllowlist: ['http://obs.client'] });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        const response = await requestStatusRaw({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            path: '/obs',
            headers: {
                Origin: 'http://obs.client'
            }
        });
        assert.equal(response.statusCode, 204);
        assert.equal(response.headers['access-control-allow-origin'], 'http://obs.client');
    } finally {
        await closeServer(fixture.server);
    }
});

test('answers CORS preflight for OBS overlay', async () => {
    const fixture = createSmokeIntegrationServer({ obsOriginAllowlist: ['http://obs.client'] });
    await new Promise((resolve) => fixture.server.listen(fixture.INTEGRATION_PORT, fixture.INTEGRATION_HOST, resolve));

    try {
        const response = await requestStatusRaw({
            serverUrl: `http://${fixture.INTEGRATION_HOST}:${fixture.INTEGRATION_PORT}`,
            method: 'OPTIONS',
            path: '/obs',
            headers: {
                Origin: 'http://obs.client',
                'Access-Control-Request-Method': 'GET'
            }
        });
        assert.equal(response.statusCode, 204);
        assert.equal(response.headers['access-control-allow-origin'], 'http://obs.client');
        assert.equal(response.headers['access-control-allow-methods'], 'GET, OPTIONS');
    } finally {
        await closeServer(fixture.server);
    }
});
