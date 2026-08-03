module.exports = function trackLoggerPlugin(context) {
    const mount = context.mountPanel({
        id: 'track-logger',
        title: 'Track Logger',
        text: 'Waiting for track...'
    });

    context.log.info(`panel mount status: ${mount && mount.status ? mount.status : 'ok'}`);

    const unsubTrack = context.onTrack((track) => {
        const label = track && track.title ? `${track.title} - ${track.artist}` : 'unknown';
        context.log.info(`[track] ${label}`);
        if (mount && mount.status === 'ok') {
            context.mountPanel({
                id: 'track-logger',
                title: 'Track Logger',
                text: `track: ${label}`
            });
        }
    });

    const unsubState = context.onState((state) => {
        if (state && typeof state.playing === 'boolean') {
            context.log.info(`[state] ${state.playing ? 'playing' : 'paused'}`);
            if (mount && mount.status === 'ok') {
                context.mountPanel({
                    id: 'track-logger',
                    title: 'Track Logger',
                    text: `state: ${state.playing ? 'playing' : 'paused'}`
                });
            }
        }
    });

    return () => {
        if (typeof unsubTrack === 'function') unsubTrack();
        if (typeof unsubState === 'function') unsubState();
    };
};
