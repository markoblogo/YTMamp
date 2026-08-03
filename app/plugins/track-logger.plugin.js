module.exports = function trackLoggerPlugin(context) {
    const unsubTrack = context.onTrack((track) => {
        console.log(`[Plugin:${context.name}] track`, track && track.title ? `${track.title} - ${track.artist}` : 'unknown');
    });

    const unsubState = context.onState((state) => {
        if (state && typeof state.playing === 'boolean') {
            console.log(`[Plugin:${context.name}] state`, state.playing ? 'playing' : 'paused');
        }
    });

    return () => {
        if (typeof unsubTrack === 'function') unsubTrack();
        if (typeof unsubState === 'function') unsubState();
    };
};
