/* Decode a short, muted preview before a new station card becomes available. */
(() => {
    class RadioStationVerifier {
        constructor({ createAudio = () => new Audio(), report, online = () => navigator.onLine !== false, concurrency = 3, timeout = 6000 }) {
            this.createAudio = createAudio; this.report = report; this.online = online;
            this.concurrency = concurrency; this.timeout = timeout; this.controller = null;
        }
        cancel() { this.controller?.abort(); }
        fresh(station) { return Number.isFinite(station.checkedAt) && Date.now() - station.checkedAt >= 0 && Date.now() - station.checkedAt < 900000; }
        async check(station, signal) {
            if (signal.aborted || !this.online()) return null;
            if (this.fresh(station)) return true;
            const audio = this.createAudio(); audio.muted = true; audio.preload = 'none'; audio.crossOrigin = 'anonymous';
            return new Promise((resolve) => {
                let finished = false;
                const done = (ok) => {
                    if (finished) return; finished = true; clearTimeout(timer);
                    signal.removeEventListener('abort', cancel);
                    audio.onplaying = null; audio.onerror = null; audio.onended = null;
                    audio.pause(); audio.removeAttribute('src'); audio.load(); resolve(ok);
                };
                const cancel = () => done(null);
                const timer = setTimeout(() => done(this.online() ? false : null), this.timeout);
                signal.addEventListener('abort', cancel, { once: true });
                audio.onplaying = () => done(true);
                audio.onerror = audio.onended = () => done(this.online() ? false : null);
                audio.src = 'ytmamp-media://radio-check/' + station.id;
                try { Promise.resolve(audio.play()).catch((error) => { if (error.name !== 'AbortError') done(this.online() ? false : null); }); }
                catch { done(false); }
            });
        }
        async verify(stations, onVerified = () => {}) {
            this.cancel(); const controller = new AbortController(); this.controller = controller;
            const result = { checked: 0, hidden: 0, canceled: false }; let cursor = 0;
            const queue = stations.map((station) => ({ station, attempt: 0 })); const seen = new Set(stations.map((s) => s.id));
            const worker = async () => {
                while (!controller.signal.aborted && cursor < queue.length) {
                    const { station, attempt } = queue[cursor++]; const cached = this.fresh(station); const ok = await this.check(station, controller.signal);
                    if (controller.signal.aborted) return;
                    if (ok === null) { result.canceled = true; continue; }
                    result.checked++;
                    const reply = cached ? {} : await this.report(station.id, ok);
                    if (controller.signal.aborted) return;
                    if (ok) onVerified({ ...station, checkedAt: cached ? station.checkedAt : Date.now() });
                    else {
                        result.hidden++;
                        if (!attempt && reply?.alternate && !seen.has(reply.alternate.id)) { seen.add(reply.alternate.id); queue.push({ station: reply.alternate, attempt: 1 }); }
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(this.concurrency, stations.length) }, worker));
            result.canceled ||= controller.signal.aborted;
            return result;
        }
    }
    if (typeof module !== 'undefined') module.exports = { RadioStationVerifier };
    else window.RadioStationVerifier = RadioStationVerifier;
})();
