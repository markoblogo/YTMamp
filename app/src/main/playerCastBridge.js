const ALLOWED_ACTIONS = new Set(['play', 'pause', 'toggle', 'stop', 'next', 'prev']);

let getPlayerSnapshot = () => ({ track: null, state: null });
let sendPlayerAction = async () => ({ ok: false, error: 'player_action_bridge_not_configured' });

function configurePlayerCastBridge(dependencies = {}) {
    if (typeof dependencies.getPlayerSnapshot === 'function') {
        getPlayerSnapshot = dependencies.getPlayerSnapshot;
    }
    if (typeof dependencies.sendPlayerAction === 'function') {
        sendPlayerAction = dependencies.sendPlayerAction;
    }
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCastTrack(track = {}) {
    const durationMs = toNumber(
        track.durationMs,
        toNumber(track.duration, 0) * 1000 || toNumber(track.durationSec, 0) * 1000
    );
    const positionMs = toNumber(
        track.positionMs,
        toNumber(track.position, 0) * 1000 || toNumber(track.positionSec, 0) * 1000
    );

    return {
        title: typeof track.title === 'string' ? track.title : 'Unknown',
        artist: typeof track.artist === 'string' ? track.artist : '',
        album: typeof track.album === 'string' ? track.album : '',
        track_id: typeof track.trackId === 'string'
            ? track.trackId
            : (typeof track.mediaId === 'string' ? track.mediaId : ''),
        duration_ms: durationMs,
        position_ms: positionMs
    };
}

async function playerGetState() {
    const snapshot = await Promise.resolve(getPlayerSnapshot());
    const state = snapshot && typeof snapshot.state === 'object' ? snapshot.state : null;
    const track = snapshot && typeof snapshot.track === 'object' ? snapshot.track : null;

    if (!track) {
        return null;
    }

    const isPlaying = Boolean(state && state.playing);
    const castState = isPlaying ? 'playing' : (state && state.error ? 'error' : 'paused');

    return {
        source: 'ytmamp',
        state: castState,
        track: normalizeCastTrack(track),
        time: Date.now(),
        raw: {
            track,
            state
        }
    };
}

async function playerAction(action) {
    const normalizedAction = String(action || '').toLowerCase();
    if (!ALLOWED_ACTIONS.has(normalizedAction)) {
        return { ok: false, error: 'invalid_action' };
    }

    const current = await Promise.resolve(getPlayerSnapshot());
    const hasTrack = Boolean(current && current.track);
    const isPlaying = Boolean(current && current.state && current.state.playing);

    if (!hasTrack && ALLOWED_ACTIONS.has(normalizedAction)) {
        return { ok: false, error: 'no_active_track' };
    }

    if (normalizedAction === 'play' && isPlaying) {
        return { ok: true, state: 'playing', note: 'already_playing' };
    }

    if (normalizedAction === 'pause' && !isPlaying) {
        return { ok: true, state: 'paused', note: 'already_paused' };
    }

    if (normalizedAction === 'stop' && !isPlaying) {
        return { ok: true, state: 'stopped', note: 'already_stopped' };
    }

    const actionMap = {
        toggle: 'playPause',
        play: 'playPause',
        pause: 'playPause',
        stop: 'playPause',
        next: 'next',
        prev: 'prev'
    };

    const playerCommand = actionMap[normalizedAction];
    const result = await Promise.resolve(sendPlayerAction(playerCommand));

    if (!result || result.ok !== true) {
        const error = (result && result.error) || 'action_failed';
        return { ok: false, error };
    }

    return { ok: true, action: playerCommand };
}

module.exports = {
    configurePlayerCastBridge,
    playerGetState,
    playerAction
};
