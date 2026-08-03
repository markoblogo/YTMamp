const { EventEmitter } = require('events');

function createPayloadKey(value) {
    try {
        return JSON.stringify(value);
    } catch (err) {
        return String(value);
    }
}

function createEventBus(options = {}) {
    const dedupeWindowMs = Number.isFinite(options.dedupeWindowMs) ? options.dedupeWindowMs : 300;
    const emitter = new EventEmitter();
    const lastEvents = new Map();

    function emit(event, payload, eventOptions = {}) {
        const dedupeMs = Number.isFinite(eventOptions.dedupeMs)
            ? eventOptions.dedupeMs
            : dedupeWindowMs;
        const now = Date.now();
        const key = createPayloadKey(payload);
        const last = lastEvents.get(event);

        if (dedupeMs > 0 && last && last.key === key && (now - last.ts) <= dedupeMs) {
            return false;
        }

        lastEvents.set(event, { key, ts: now });
        emitter.emit(event, payload);
        return true;
    }

    function on(event, handler) {
        emitter.on(event, handler);
        return () => emitter.off(event, handler);
    }

    function removeAllListeners(event) {
        emitter.removeAllListeners(event);
    }

    return {
        emit,
        on,
        removeAllListeners
    };
}

module.exports = {
    createEventBus
};
