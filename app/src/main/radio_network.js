const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { Readable } = require('node:stream');

function publicAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
            (a === 198 && (b === 18 || b === 19)));
    }
    // Reject mapped, local, multicast and transition addresses. Public global unicast only.
    return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) &&
        !/^200[12]:/i.test(address) && !/^2001:db8:/i.test(address);
}
function checkedUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096 ||
        /[\r\n]/.test(value) || !url.hostname || url.hostname.endsWith('.local') || url.hostname === 'localhost') throw new Error('Use a public HTTP or HTTPS address.');
    const ip = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(ip) && !publicAddress(ip)) throw new Error('Private network addresses are not supported.');
    return url;
}
async function openRemote(value, { signal, userAgent = 'YTMamp/0.7.0', redirects = 5 } = {}) {
    const url = checkedUrl(value);
    signal?.throwIfAborted();
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await Promise.race([
        dns.lookup(host, { all: true }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS timeout')), 8000); timer.unref?.(); })
    ]);
    signal?.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Station address is not public.');
    return new Promise((resolve, reject) => {
        const chosen = addresses[0];
        const request = (url.protocol === 'https:' ? https : http).get(url, {
            signal, agent: false, headers: { 'user-agent': userAgent, accept: '*/*', 'icy-metadata': '0' },
            lookup: (_hostname, options, callback) => options.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family)
        }, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.destroy();
                if (!redirects || !response.headers.location) return reject(new Error('Too many station redirects.'));
                openRemote(new URL(response.headers.location, url).href, { signal, userAgent, redirects: redirects - 1 }).then(resolve, reject);
            } else if (response.statusCode !== 200) { response.destroy(); reject(new Error('Station returned HTTP ' + response.statusCode)); }
            else resolve(response);
        });
        request.setTimeout(15000, () => request.destroy(new Error('Station timed out.')));
        request.on('error', reject);
    });
}
async function getBytes(url, { maxBytes = 8 * 1024 * 1024, signal, ...options } = {}) {
    const timeout = AbortSignal.timeout(15000);
    const response = await openRemote(url, { ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const chunks = []; let size = 0;
    for await (const chunk of response) {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); throw new Error('Radio response too large.'); }
        chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), type: String(response.headers['content-type'] || '').split(';')[0].toLowerCase() };
}
async function getJson(url, options) { return JSON.parse((await getBytes(url, options)).bytes.toString('utf8')); }

class RadioBrowser {
    constructor() { this.servers = []; this.discoveredAt = 0; }
    async discover() {
        if (this.servers.length && Date.now() - this.discoveredAt < 3600000) return;
        try {
            const records = await Promise.race([dns.resolveSrv('_api._tcp.radio-browser.info'), new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('DNS timeout')), 4000); t.unref?.(); })]);
            this.servers = records.map((record) => record.name.replace(/\.$/, '')).filter((name) => /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(name));
        } catch { this.servers = ['de1.api.radio-browser.info', 'nl1.api.radio-browser.info']; }
        if (!this.servers.length) this.servers = ['de1.api.radio-browser.info', 'nl1.api.radio-browser.info'];
        this.servers.sort(() => Math.random() - 0.5); this.discoveredAt = Date.now();
    }
    async request(path, signal) {
        await this.discover();
        let error;
        for (const server of this.servers.slice(0, 3)) {
            signal?.throwIfAborted();
            try { return await getJson('https://' + server + path, { signal }); } catch (failure) { error = failure; }
        }
        throw error || new Error('Radio directory unavailable.');
    }
    search(query, signal) { return this.request('/json/stations/search?' + new URLSearchParams(query), signal); }
    click(uuid) {
        if (/^[a-f0-9-]{36}$/i.test(uuid)) this.request('/json/url/' + uuid, AbortSignal.timeout(6000)).catch(() => {});
    }
}
function createRadioMediaHandler(resolveStation) {
    const logos = new Map(); let logoBytes = 0;
    return async (request) => {
        try {
            const url = new URL(request.url);
            if (!['radio', 'radio-art'].includes(url.hostname) || !/^\/[a-f0-9]{64}$/.test(url.pathname) ||
                url.search || url.port || url.username || url.password || request.method !== 'GET') return new Response(null, { status: 404 });
            const station = resolveStation(url.pathname.slice(1));
            if (!station) return new Response(null, { status: 404 });
            const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
            if (url.hostname === 'radio-art') {
                if (!station.favicon) return new Response(null, { status: 404 });
                const cached = logos.get(station.favicon);
                if (cached) { logos.delete(station.favicon); logos.set(station.favicon, cached); return new Response(cached.bytes, { headers: { ...headers, 'content-type': cached.type } }); }
                const data = await getBytes(station.favicon, { signal: request.signal, maxBytes: 512 * 1024 });
                if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(data.type)) return new Response(null, { status: 415 });
                if (!logos.has(station.favicon)) { logos.set(station.favicon, data); logoBytes += data.bytes.length; }
                while (logoBytes > 16 * 1024 * 1024) { const oldest = logos.keys().next().value; logoBytes -= logos.get(oldest).bytes.length; logos.delete(oldest); }
                return new Response(data.bytes, { headers: { ...headers, 'content-type': data.type } });
            }
            const response = await openRemote(station.url, { signal: request.signal });
            const type = String(response.headers['content-type'] || 'audio/mpeg').split(';')[0].toLowerCase();
            if (station.hls || /mpegurl|scpls|text\/|html|json|xml/.test(type)) { response.destroy(); return new Response(null, { status: 415 }); }
            const abort = () => response.destroy();
            request.signal.addEventListener('abort', abort, { once: true });
            response.once('close', () => request.signal.removeEventListener('abort', abort));
            if (request.signal.aborted) response.destroy();
            return new Response(Readable.toWeb(response), { headers: { ...headers, 'content-type': type } });
        } catch { return new Response(null, { status: 502 }); }
    };
}
module.exports = { publicAddress, checkedUrl, openRemote, getJson, RadioBrowser, createRadioMediaHandler };
