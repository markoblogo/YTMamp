function createYtmLauncher({ openExternal, now = Date.now }) {
    let lastOpen = -Infinity;
    return async ({ connected = false, force = false } = {}) => {
        if (connected || (!force && now() - lastOpen < 30000)) return false;
        lastOpen = now();
        try { await openExternal('https://music.youtube.com/'); return true; }
        catch { lastOpen = -Infinity; throw new Error('Could not open YouTube Music. Use the OPEN button to retry.'); }
    };
}
module.exports = { createYtmLauncher };
