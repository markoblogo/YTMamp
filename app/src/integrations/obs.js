function parseAllowlist(value) {
    if (!value || typeof value !== 'string') return new Set();
    const normalized = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    return new Set(normalized);
}

function isOriginAllowed(origin, allowlist, logger = console) {
    const normalizedOrigin = (typeof origin === 'string' ? origin.trim() : '');
    if (!normalizedOrigin) return true;
    if (!allowlist || allowlist.size === 0) {
        logger.warn('[OBS] Blocked request due to empty allowlist');
        return false;
    }
    if (allowlist.has('*')) return true;
    return allowlist.has(normalizedOrigin);
}

function getCorsHeaders(origin, allowlist, logger = console) {
    if (!isOriginAllowed(origin, allowlist, logger)) {
        return {};
    }
    const normalizedOrigin = (typeof origin === 'string' ? origin.trim() : '');
    if (!normalizedOrigin) return {};
    return {
        'access-control-allow-origin': normalizedOrigin,
        'access-control-allow-credentials': 'true',
        'vary': 'Origin'
    };
}

function normalizeTrackField(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '';
}

function normalizeLikes(value) {
    return Number.isFinite(value) ? value : null;
}

function normalizeCover(track) {
    return normalizeTrackField(track.cover ||
        track.coverUrl ||
        track.artwork ||
        track.image ||
        track.thumbnail ||
        track.poster || '');
}

function buildObsPayload(track, state) {
    if (!track || typeof track !== 'object') return null;

    const position = state && Number.isFinite(state.positionSec) ? Math.max(0, Math.floor(state.positionSec)) : 0;
    const likes = normalizeLikes(track.likes);
    const payload = {
        title: normalizeTrackField(track.title),
        artist: normalizeTrackField(track.artist),
        cover: normalizeCover(track),
        position,
        likes
    };

    return payload;
}

function isValidObsPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(payload, 'title')) return false;
    if (!Object.prototype.hasOwnProperty.call(payload, 'artist')) return false;
    if (!Object.prototype.hasOwnProperty.call(payload, 'cover')) return false;
    if (!Object.prototype.hasOwnProperty.call(payload, 'position')) return false;
    if (!Object.prototype.hasOwnProperty.call(payload, 'likes')) return false;

    return typeof payload.title === 'string' &&
        typeof payload.artist === 'string' &&
        typeof payload.position === 'number' &&
        (payload.cover === '' || typeof payload.cover === 'string') &&
        (payload.likes === null || Number.isFinite(payload.likes));
}

function createObsOverlayService(options = {}) {
    const logger = options.logger || console;
    const allowlist = parseAllowlist(options.allowlist);

    return {
        isOriginAllowed(origin) {
            return isOriginAllowed(origin, allowlist, logger);
        },
        getCorsHeaders(origin) {
            return getCorsHeaders(origin, allowlist, logger);
        },
        buildPayload({ track, state }) {
            return buildObsPayload(track, state);
        },
        isValidPayload(payload) {
            return isValidObsPayload(payload);
        },
        getAllowlist: () => Array.from(allowlist)
    };
}

module.exports = {
    createObsOverlayService,
    parseAllowlist,
    buildObsPayload,
    isValidObsPayload
};
