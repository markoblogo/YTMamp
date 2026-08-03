const crypto = require('crypto');
const https = require('https');
const { URLSearchParams } = require('url');
const { createRetryQueue } = require('./retryQueue');

const LAST_FM_API_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const DEFAULT_TRACK_THRESHOLD_SEC = 240;
const DEFAULT_MIN_TRACK_DURATION_SEC = 30;
const LAST_FM_REQUIRED_KEYS = ['api_key', 'api_sig', 'sk', 'artist', 'track'];

function parseIntEnv(value, fallback) {
    const parsed = Number.parseInt((value || '').toString().trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizeString(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function normalizeTrackPayload(track) {
    if (!track || typeof track !== 'object') return null;

    const title = normalizeString(track.title);
    const artist = normalizeString(track.artist);
    if (!title || !artist) return null;

    const durationSec = Number.isFinite(track.durationSec) && track.durationSec > 0 ? Math.floor(track.durationSec) : null;

    return {
        title,
        artist,
        album: normalizeString(track.album || ''),
        durationSec,
        mediaId: normalizeString(track.mediaId || ''),
        trackId: normalizeString(track.trackId || ''),
        source: normalizeString(track.source || ''),
        likes: Number.isFinite(track.likes) ? track.likes : null,
        positionSec: Number.isFinite(track.positionSec) ? Math.max(0, Math.floor(track.positionSec)) : null
    };
}

function trackFingerprint(track) {
    return `${track.artist.toLowerCase()}|${track.title.toLowerCase()}|${track.album.toLowerCase()}`;
}

function buildApiSignature(params, apiSecret) {
    const keys = Object.keys(params).sort();
    const base = keys
        .filter((key) => key !== 'format')
        .map((key) => `${key}${params[key]}`)
        .join('');
    return crypto.createHash('md5').update(base + apiSecret).digest('hex');
}

function requiredPlaySeconds(durationSec, thresholdSec, minDurationSec) {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return thresholdSec;
    return Math.max(minDurationSec, Math.min(thresholdSec, Math.floor(durationSec / 2)));
}

async function postLastFm(payload, userAgent) {
    const body = new URLSearchParams(payload).toString();

    return await new Promise((resolve, reject) => {
        const requestUrl = new URL(LAST_FM_API_BASE_URL);
        const req = https.request({
            protocol: requestUrl.protocol,
            hostname: requestUrl.hostname,
            path: requestUrl.pathname,
            method: 'POST',
            headers: {
                'user-agent': userAgent || 'ytmamp-desktop',
                'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
                'content-length': Buffer.byteLength(body),
                'accept': 'application/json'
            }
        }, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            res.on('end', () => {
                const statusCode = res.statusCode || 0;
                let parsed;

                if (responseBody && responseBody.trim()) {
                    try {
                        parsed = JSON.parse(responseBody);
                    } catch (error) {
                        parsed = { _raw: responseBody };
                    }
                }

                resolve({
                    statusCode,
                    body: responseBody,
                    parsed,
                    headers: res.headers
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(body);
        req.end();
    });
}

function buildRequestParams({ method, apiKey, sessionKey, apiSecret, track }) {
    const params = {
        method,
        api_key: apiKey,
        sk: sessionKey,
        track: track.title,
        artist: track.artist,
        format: 'json'
    };

    if (track.album) params.album = track.album;
    if (Number.isFinite(track.durationSec) && track.durationSec > 0) {
        params.duration = String(track.durationSec);
    }
    if (track.timestamp) {
        params.timestamp = String(track.timestamp);
    }

    const signature = buildApiSignature(params, apiSecret);
    params.api_sig = signature;

    return params;
}

function evaluateResponse(statusCode, parsed) {
    if (statusCode >= 200 && statusCode < 300) {
        if (parsed && parsed.error) {
            return {
                ok: false,
                retryable: false,
                error: parsed.error,
                message: parsed.message
            };
        }
        return { ok: true, retryable: false };
    }

    if (statusCode === 429) {
        return {
            ok: false,
            retryable: true,
            error: 'rate_limited'
        };
    }

    if (statusCode >= 500 && statusCode < 600) {
        return { ok: false, retryable: true, error: 'server_error' };
    }

    return {
        ok: false,
        retryable: false,
        error: `request_failed_${statusCode}`
    };
}

function createLastFmScrobbler(options = {}) {
    const cfg = {
        apiKey: normalizeString(options.apiKey),
        apiSecret: normalizeString(options.apiSecret),
        sessionKey: normalizeString(options.sessionKey),
        queueStoragePath: normalizeString(options.queueStoragePath),
        userAgent: normalizeString(options.userAgent) || 'ytmamp-desktop',
        enabled: parseBoolean(options.enabled),
        thresholdSec: parseIntEnv(options.thresholdSec, DEFAULT_TRACK_THRESHOLD_SEC),
        minDurationSec: parseIntEnv(options.minDurationSec, DEFAULT_MIN_TRACK_DURATION_SEC),
        processIntervalMs: parseIntEnv(options.processIntervalMs, 1000),
        baseRetryMs: parseIntEnv(options.baseRetryMs, 5000),
        maxRetryMs: parseIntEnv(options.maxRetryMs, 60000),
        logger: options.logger || { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } }
    };

    const logger = cfg.logger;
    const isEnabled = cfg.enabled && cfg.apiKey && cfg.apiSecret && cfg.sessionKey;

    if (!isEnabled) {
        logger.warn('[LastFM] Skipped: required credentials are not set');
    }

    let queue;
    let currentTrack = null;
    let currentTrackFingerprint = '';
    let nowPlayingDispatched = false;
    let scrobbled = false;
    let playedPositionSec = 0;
    let lastStateSec = 0;
    let lastStateTs = null;

    function maybeDispatchNowPlaying(payload) {
        const fingerprint = trackFingerprint(payload);
        if (!queue) return;
        if (currentTrackFingerprint === fingerprint && nowPlayingDispatched) return;

        queue.enqueue({
            type: 'nowPlaying',
            track: payload
        }, {
            type: 'nowPlaying',
            trackFingerprint: fingerprint
        });

        nowPlayingDispatched = true;
        logger.debug(`[LastFM] queued now playing for ${payload.artist} - ${payload.title}`);
    }

    function maybeDispatchScrobble(payload, playedSeconds) {
        if (!queue || scrobbled) return;

        queue.enqueue({
            type: 'scrobble',
            track: {
                ...payload,
                playSec: Math.max(1, Math.floor(playedSeconds))
            }
        }, {
            type: 'scrobble',
            trackFingerprint: currentTrackFingerprint
        });

        scrobbled = true;
        logger.debug(`[LastFM] queued scrobble for ${payload.artist} - ${payload.title} (${Math.floor(playedSeconds)}s)`);
    }

    function onTrackChanged(track) {
        if (!isEnabled || !track) return;

        if (currentTrack && currentTrackFingerprint === trackFingerprint(track) && nowPlayingDispatched) {
            return;
        }

        if (currentTrack) {
            const required = requiredPlaySeconds(currentTrack.durationSec, cfg.thresholdSec, cfg.minDurationSec);
            if (!scrobbled && playedPositionSec >= required) {
                maybeDispatchScrobble(currentTrack, playedPositionSec);
            }
        }

        currentTrack = track;
        currentTrackFingerprint = trackFingerprint(track);
        nowPlayingDispatched = false;
        scrobbled = false;
        playedPositionSec = Number.isFinite(track.positionSec) ? Math.max(0, track.positionSec) : 0;
        lastStateSec = playedPositionSec;
        lastStateTs = Date.now();

        maybeDispatchNowPlaying(track);
    }

    function onStateChanged(state) {
        if (!isEnabled || !currentTrack || !state) return;
        if (typeof state !== 'object') return;

        const nextPosition = Number.isFinite(state.positionSec) ? Math.max(0, state.positionSec) : playedPositionSec;
        const durationSec = Number.isFinite(state.durationSec) ? Math.max(0, state.durationSec) : currentTrack.durationSec;

        if (nextPosition > playedPositionSec) {
            playedPositionSec = nextPosition;
        }

        currentTrack.durationSec = durationSec || currentTrack.durationSec;

        if (!nowPlayingDispatched && state.playing) {
            maybeDispatchNowPlaying(currentTrack);
        }

        const required = requiredPlaySeconds(currentTrack.durationSec, cfg.thresholdSec, cfg.minDurationSec);
        const shouldCheckScrobble = state.playing || (!state.playing && lastStateSec > 0 && playedPositionSec >= cfg.minDurationSec);
        if (shouldCheckScrobble && !scrobbled && playedPositionSec >= required) {
            maybeDispatchScrobble(currentTrack, playedPositionSec);
        }

        lastStateSec = nextPosition;
        lastStateTs = Date.now();
    }

    async function processQueueItem(item) {
        if (!item || typeof item !== 'object') {
            return { ok: false, retryable: false };
        }

        const track = normalizeTrackPayload(item.track);
        if (!track) {
            return { ok: false, retryable: false };
        }

        const now = Math.floor(Date.now() / 1000);
        const isScrobble = item.type === 'scrobble';
        const method = isScrobble ? 'track.scrobble' : 'track.updateNowPlaying';
        const playSec = Number.isFinite(track.playSec) ? Math.max(1, Math.floor(track.playSec)) : undefined;
        const scrobbleTimestamp = isScrobble ? (track.timestamp || now) : undefined;

        const params = buildRequestParams({
            method,
            apiKey: cfg.apiKey,
            sessionKey: cfg.sessionKey,
            apiSecret: cfg.apiSecret,
            track: {
                ...track,
                timestamp: scrobbleTimestamp
            }
        });

        if (isScrobble) {
            if (Number.isFinite(track.timestamp) && track.timestamp > 0) {
                params.timestamp = String(track.timestamp);
            } else {
                params.timestamp = String(now);
            }
            params.track = track.title;
            params.artist = track.artist;
            if (Number.isFinite(playSec)) {
                params.duration = String(playSec);
            }
        }

        const missing = LAST_FM_REQUIRED_KEYS.some((key) => typeof params[key] !== 'string' || !params[key]);
        if (missing) {
            return { ok: false, retryable: false, error: 'invalid_payload' };
        }

        try {
            const response = await postLastFm(params, cfg.userAgent);
            const result = evaluateResponse(response.statusCode, response.parsed);

            if (result.ok) {
                return { ok: true, retryable: false };
            }

            const retryAfterHeader = response.headers && response.headers['retry-after'];
            const retryAfterMs = Number.parseInt(retryAfterHeader, 10);

            return {
                ok: false,
                retryable: result.retryable,
                retryAfterMs: result.retryable && Number.isFinite(retryAfterMs) ? retryAfterMs * 1000 : undefined,
                error: result.error
            };
        } catch (error) {
            logger.warn(`[LastFM] request failed: ${error.message}`);
            return { ok: false, retryable: true, error: 'network_error' };
        }
    }

    function createQueue() {
        if (!isEnabled) return null;

        return createRetryQueue({
            storagePath: cfg.queueStoragePath,
            processItem: processQueueItem,
            maxAttempts: 6,
            processIntervalMs: cfg.processIntervalMs,
            baseDelayMs: cfg.baseDelayMs,
            maxDelayMs: cfg.maxRetryMs,
            logger
        });
    }

    queue = createQueue();

    function start() {
        if (!isEnabled || !queue) return;
        queue.start();
    }

    function stop() {
        if (!isEnabled || !queue) return;
        queue.stop();
    }

    function getState() {
        return {
            enabled: isEnabled,
            queue: queue ? queue.getQueue() : [],
            currentTrackFingerprint
        };
    }

    return {
        handleTrack(track) {
            if (!isEnabled) return;
            const normalized = normalizeTrackPayload(track);
            if (!normalized) return;
            onTrackChanged({
                ...normalized,
                timestamp: Math.floor(Date.now() / 1000)
            });
        },
        handleState(state) {
            if (!isEnabled) return;
            onStateChanged(state);
        },
        start,
        stop,
        getState
    };
}

module.exports = {
    createLastFmScrobbler,
    DEFAULT_TRACK_THRESHOLD_SEC,
    DEFAULT_MIN_TRACK_DURATION_SEC
};
