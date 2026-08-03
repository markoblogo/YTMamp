const crypto = require('crypto');
const fs = require('fs');

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 60000;
const DEFAULT_PROCESS_INTERVAL_MS = 1000;

function clampInt(value, fallback, min = 1) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
}

function defaultLogger() {
    return {
        debug: (...args) => console.debug('[RetryQueue]', ...args),
        info: (...args) => console.info('[RetryQueue]', ...args),
        warn: (...args) => console.warn('[RetryQueue]', ...args),
        error: (...args) => console.error('[RetryQueue]', ...args)
    };
}

function normalizePayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const snapshot = { ...payload };
    if (!Number.isFinite(snapshot.timestamp)) snapshot.timestamp = Date.now();
    return snapshot;
}

function loadQueue(storagePath, logger) {
    if (!storagePath) return [];

    try {
        const raw = fs.readFileSync(storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
                attempts: Math.max(0, Number(item.attempts) || 0),
                nextAttemptAt: Number(item.nextAttemptAt) || Date.now(),
                createdAt: Number(item.createdAt) || Date.now(),
                payload: normalizePayload(item.payload)
            }))
            .filter((item) => item.payload !== null);
    } catch (error) {
        logger.warn(`[RetryQueue] Failed to read queue from ${storagePath}, starting with empty queue: ${error.message}`);
        return [];
    }
}

function saveQueue(storagePath, queue, logger) {
    if (!storagePath) return;

    try {
        const payload = queue
            .map((item) => ({
                id: item.id,
                attempts: item.attempts,
                nextAttemptAt: item.nextAttemptAt,
                createdAt: item.createdAt,
                payload: item.payload
            }));
        fs.writeFileSync(storagePath, JSON.stringify(payload, null, 2));
    } catch (error) {
        logger.warn(`[RetryQueue] Failed to save queue to ${storagePath}: ${error.message}`);
    }
}

function calculateDelayMs(attempt, baseDelayMs, maxDelayMs) {
    const exponent = Math.min(attempt, 12);
    const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
    const jitter = Math.round(exponential * 0.15 * (Math.random() - 0.5) * 2);
    return Math.max(250, exponential + jitter);
}

function createRetryQueue(options = {}) {
    const logger = options.logger || defaultLogger();
    const storagePath = options.storagePath || '';
    const processItem = options.processItem || (async () => ({ ok: false, retryable: true }));
    const maxAttempts = clampInt(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1);
    const baseDelayMs = clampInt(options.baseDelayMs, DEFAULT_BASE_DELAY_MS, 250);
    const maxDelayMs = clampInt(options.maxDelayMs, DEFAULT_MAX_DELAY_MS, baseDelayMs);
    const processIntervalMs = clampInt(options.processIntervalMs, DEFAULT_PROCESS_INTERVAL_MS, 250);

    const queue = loadQueue(storagePath, logger);
    let timer = null;
    let stopped = false;

    function persist() {
        if (!storagePath) return;
        saveQueue(storagePath, queue, logger);
    }

    function isReady(item) {
        return item.nextAttemptAt <= Date.now();
    }

    function sortBySchedule() {
        queue.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
    }

    function enqueue(payload, meta = {}) {
        const normalized = normalizePayload(payload);
        if (!normalized) {
            logger.warn('[RetryQueue] skip enqueue: payload is invalid');
            return null;
        }

        const item = {
            id: typeof meta.id === 'string' && meta.id ? meta.id : crypto.randomUUID(),
            attempts: 0,
            nextAttemptAt: Date.now(),
            createdAt: Date.now(),
            payload: normalized,
            meta: typeof meta === 'object' ? meta : {}
        };
        queue.push(item);
        sortBySchedule();
        persist();
        logger.debug(`[RetryQueue] queued item ${item.id}`);
        return item;
    }

    function removeItem(itemId) {
        const index = queue.findIndex((item) => item.id === itemId);
        if (index === -1) return;
        queue.splice(index, 1);
        persist();
    }

    function reschedule(item, retryAfterMs) {
        const baseDelay = Number.isFinite(retryAfterMs) ? Math.max(250, retryAfterMs) : calculateDelayMs(item.attempts + 1, baseDelayMs, maxDelayMs);
        item.attempts += 1;
        item.nextAttemptAt = Date.now() + baseDelay;
        if (item.attempts >= maxAttempts) {
            logger.warn(`[RetryQueue] dropping item ${item.id} after ${item.attempts} attempts`);
            removeItem(item.id);
            return;
        }
        logger.debug(`[RetryQueue] retrying item ${item.id} in ${baseDelay}ms (attempt ${item.attempts})`);
        persist();
    }

    async function processOne() {
        if (!queue.length || stopped) return;
        sortBySchedule();
        const item = queue[0];
        if (!isReady(item)) return;

        try {
            const result = await processItem(item.payload, item.meta);
            if (result && result.ok) {
                logger.info(`[RetryQueue] item ${item.id} processed successfully`);
                removeItem(item.id);
                return;
            }

            if (!result || result.retryable === false || item.attempts + 1 >= maxAttempts) {
                logger.warn(`[RetryQueue] dropping non-retryable item ${item.id}`);
                removeItem(item.id);
                return;
            }

            reschedule(item, Number.isFinite(result.retryAfterMs) ? result.retryAfterMs : undefined);
        } catch (error) {
            logger.error(`[RetryQueue] processing error for item ${item.id}: ${error.message}`);
            if (item.attempts + 1 >= maxAttempts) {
                removeItem(item.id);
                return;
            }
            reschedule(item);
        }
    }

    function run() {
        void processOne();
    }

    function start() {
        if (timer) return;
        stopped = false;
        timer = setInterval(run, processIntervalMs);
        run();
        logger.info('[RetryQueue] started');
    }

    function stop() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
        stopped = true;
        persist();
        logger.info('[RetryQueue] stopped');
    }

    return {
        enqueue,
        start,
        stop,
        flush: run,
        getQueue: () => queue.map((item) => ({ ...item }))
    };
}

module.exports = {
    createRetryQueue,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_BASE_DELAY_MS,
    DEFAULT_MAX_DELAY_MS,
    DEFAULT_PROCESS_INTERVAL_MS
};
