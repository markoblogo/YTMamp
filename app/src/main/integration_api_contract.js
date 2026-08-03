const INTEGRATION_API_VERSION = 1;

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNullableObject(value) {
    return value === null || isPlainObject(value);
}

function getRequestedIntegrationApiVersion(queryParams = new Map(), headers = {}) {
    const raw = (
        queryParams.get('api_version') ||
        queryParams.get('apiVersion') ||
        queryParams.get('api') ||
        queryParams.get('v') ||
        headers['x-ytmamp-api-version'] ||
        headers['x-api-version'] ||
        ''
    ).toString().trim();

    if (!raw) return INTEGRATION_API_VERSION;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function isSupportedIntegrationApiVersion(version) {
    return Number.isInteger(version) && version === INTEGRATION_API_VERSION;
}

function validateCanonicalPayload(payload) {
    if (!isPlainObject(payload)) return false;
    if (payload.v !== INTEGRATION_API_VERSION) return false;
    if (typeof payload.status !== 'string' || payload.status.length === 0) return false;
    if (!isNullableObject(payload.track)) return false;
    if (!isNullableObject(payload.state)) return false;
    if (!Number.isFinite(payload.updatedAt) || payload.updatedAt < 0) return false;
    if (typeof payload.windowVisible !== 'boolean') return false;
    return true;
}

function validateIntegrationEventEnvelope(eventPayload) {
    if (!isPlainObject(eventPayload)) return false;
    if (eventPayload.v !== INTEGRATION_API_VERSION) return false;
    if (typeof eventPayload.type !== 'string' || eventPayload.type.length === 0) return false;
    if (!isPlainObject(eventPayload.payload)) return false;

    return true;
}

module.exports = {
    INTEGRATION_API_VERSION,
    getRequestedIntegrationApiVersion,
    isSupportedIntegrationApiVersion,
    validateCanonicalPayload,
    validateIntegrationEventEnvelope
};

