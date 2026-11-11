const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RadioBrowser, checkedUrl } = require('./radio_network');
const clean = (value, max = 200) => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max) : '';
const normalize = (value) => clean(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
function frequency(name) {
    const match = /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:MHz|FM)\b/i.exec(name) || /\bFM\s*(\d{2,3}(?:[.,]\d{1,2})?)\b/i.exec(name);
    const value = match ? Number(match[1].replace(',', '.')) : 0;
    return value >= 87.5 && value <= 108 ? value : null;
}
function stationFrom(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.lastcheckok === 0) return null;
    let url; try { url = checkedUrl(raw.url_resolved || raw.url).href; } catch { return null; }
    const uuid = /^[a-f0-9-]{36}$/i.test(raw.stationuuid || '') ? raw.stationuuid : '';
    const name = clean(raw.name) || 'Radio station';
    let favicon = ''; try { if (raw.favicon) favicon = checkedUrl(raw.favicon).href; } catch { /* optional image */ }
    const lat = raw.geo_lat ?? raw.lat; const lon = raw.geo_long ?? raw.lon;
    return { id: crypto.createHash('sha256').update(uuid || url).digest('hex'), uuid, name, url, favicon,
        countrycode: clean(raw.countrycode, 2).toUpperCase(), region: clean(raw.state || raw.region),
        language: clean(raw.language), genre: clean(raw.tags || raw.genre, 400), codec: clean(raw.codec, 30),
        hls: raw.hls === 1 || raw.hls === true, lat: typeof lat === 'number' && Math.abs(lat) <= 90 ? lat : null,
        lon: typeof lon === 'number' && Math.abs(lon) <= 180 ? lon : null, frequency: frequency(name), custom: raw.custom === true };
}
function distanceKm(a, b) {
    const rad = (v) => v * Math.PI / 180;
    const dLat = rad(a.lat - b.lat); const dLon = rad(a.lon - b.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function filterStations(stations, query = {}) {
    const fields = { name: 'name', genre: 'genre', language: 'language', region: 'region', country: 'countrycode' };
    const filtered = stations.filter((station) => Object.entries(fields).every(([key, field]) => !query[key] || normalize(station[field]).includes(normalize(query[key]))));
    const sort = fields[query.sort] || 'name';
    return filtered.sort((a, b) => String(a[sort]).localeCompare(String(b[sort]), undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name));
}
function stationKey(station) { return normalize(station.name).replace(/\([^)]*(?:aac|mp3|hifi|metadata|bose)[^)]*\)/g, '').replace(/[^\p{L}\p{N}]/gu, '') + '|' + station.countrycode; }
function distinctStations(stations) {
    const groups = new Map();
    const score = (s) => (s.hls ? 0 : 100) + (/MP3|AAC|OGG|OPUS/i.test(s.codec) ? 10 : 0) + (s.favicon ? 1 : 0);
    for (const station of stations) {
        const key = stationKey(station); const previous = groups.get(key);
        if (!previous || score(station) > score(previous)) groups.set(key, station);
    }
    return [...groups.values()];
}
class RadioLibrary {
    constructor({ directory, browser = new RadioBrowser() }) {
        this.file = path.join(directory, 'radio-library-v1.json'); this.browser = browser;
        this.stations = new Map(); this.favorites = new Set(); this.tuning = new Map(); this.failed = new Map(); this.checked = new Map(); this.location = null; this.searchController = null;
        try {
            if (fs.statSync(this.file).size > 8 * 1024 * 1024) return;
            const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            for (const raw of (saved.stations || []).slice(0, 2000)) { const station = stationFrom({ ...raw, stationuuid: raw.uuid }); if (station) this.stations.set(station.id, station); }
            this.favorites = new Set((saved.favorites || []).filter((id) => this.stations.has(id)).slice(0, 500));
            for (const item of (saved.failed || []).slice(0, 2000)) if (this.stations.has(item.id) && Number.isFinite(item.until) && item.until > Date.now() && item.until <= Date.now() + 300000) this.failed.set(item.id, item.until);
            for (const item of (saved.checked || []).slice(0, 2000)) if (this.stations.has(item.id) && Number.isFinite(item.at) && item.at <= Date.now() && item.at > Date.now() - 900000 && item.address === this.addressKey(item.id)) this.checked.set(item.id, item);
            for (const item of (saved.tuning || []).slice(0, 500)) if (/^[a-f0-9]{64}$/.test(item.id) && Number.isFinite(item.frequency) && item.frequency >= 87.5 && item.frequency <= 108 && Number.isFinite(item.lat) && Math.abs(item.lat) <= 90 && Number.isFinite(item.lon) && Math.abs(item.lon) <= 180) this.tuning.set(item.id, item);
            if (saved.location && Number.isFinite(saved.location.lat) && Math.abs(saved.location.lat) <= 90 && Number.isFinite(saved.location.lon) && Math.abs(saved.location.lon) <= 180) this.location = { lat: saved.location.lat, lon: saved.location.lon, label: clean(saved.location.label), countrycode: clean(saved.location.countrycode, 2) };
        } catch { /* first launch */ }
    }
    save() {
        const keep = [...this.stations.values()].reverse().sort((a, b) => Number(this.favorites.has(b.id) || this.tuning.has(b.id) || b.custom || this.activeId === b.id) - Number(this.favorites.has(a.id) || this.tuning.has(a.id) || a.custom || this.activeId === a.id)).slice(0, 2000);
        const temp = this.file + '.tmp';
        const keptIds = new Set(keep.map((s) => s.id));
        this.checked = new Map([...this.checked].filter(([id, item]) => keptIds.has(id) && item.at > Date.now() - 900000));
        fs.writeFileSync(temp, JSON.stringify({ stations: keep, favorites: [...this.favorites], tuning: [...this.tuning.values()], failed: [...this.failed].filter(([,until]) => until > Date.now()).map(([id,until]) => ({id,until})), checked: [...this.checked.values()], location: this.location }), { mode: 0o600 });
        fs.renameSync(temp, this.file); this.stations = new Map(keep.map((s) => [s.id, s]));
    }
    usable(station) { return !station.hls && !(this.failed.get(station.id) > Date.now()); }
    addressKey(id) { return crypto.createHash('sha256').update(this.stations.get(id)?.url || '').digest('hex'); }
    markFailed(id) { if (this.stations.has(id)) { this.checked.delete(id); this.failed.set(id, Date.now() + 300000); this.save(); } }
    markSuccessful(id) { if (!this.stations.has(id)) return; const prior = this.checked.get(id); if (this.failed.delete(id) || !prior || prior.address !== this.addressKey(id) || Date.now() - prior.at > 60000) { this.checked.set(id, { id, at: Date.now(), address: this.addressKey(id) }); this.save(); } }
    retryStation(id) { const station = this.stations.get(id); if (!station) return; for (const candidate of this.stations.values()) if (stationKey(candidate) === stationKey(station)) this.failed.delete(candidate.id); this.save(); }
    public(station) { const { url, favicon, ...rest } = station; const check = this.checked.get(station.id); return { ...rest, checkedAt: check?.address === this.addressKey(station.id) ? check.at : 0, playable: this.usable(station), cover: favicon ? 'ytmamp-media://radio-art/' + station.id : '', favorite: this.favorites.has(station.id) }; }
    alternatives(id) { const selected = this.stations.get(id); return selected ? [...this.stations.values()].filter((s) => this.usable(s) && stationKey(s) === stationKey(selected)) : []; }
    local() {
        if (!this.location) return [];
        return [...this.stations.values()].filter((s) => this.usable(s)).map((station) => {
            const override = this.tuning.get(station.id);
            const point = override || station;
            const mhz = override?.frequency || station.frequency;
            if (!mhz || point.lat === null || point.lon === null || distanceKm(this.location, point) > 60) return null;
            return { ...this.public(station), frequency: mhz, frequencySource: override ? 'Your local frequency' : 'Frequency supplied in station name' };
        }).filter(Boolean).sort((a, b) => a.frequency - b.frequency || a.name.localeCompare(b.name));
    }
    snapshot() { return { stations: distinctStations([...this.stations.values()].filter((s) => this.usable(s) && (this.favorites.has(s.id) || s.custom))).map((s) => this.public(s)), local: this.local(), location: this.location }; }
    async search(query = {}) {
        this.searchController?.abort(); this.searchController = new AbortController();
        const controller = this.searchController;
        const offset = Math.max(0, Math.min(1000, Number(query.offset) || 0));
        const cachedPage = () => {
            const stations = filterStations(distinctStations([...this.stations.values()].filter((s) => this.usable(s) && (query.view !== 'favorites' || this.favorites.has(s.id)))), query);
            return { stations: stations.slice(offset, offset + 24).map((s) => this.public(s)), cached: true, more: stations.length > offset + 24 };
        };
        if (query.view === 'favorites') return cachedPage();
        const params = { limit: '24', offset: String(offset), hidebroken: 'true', order: ['name', 'language', 'tags', 'state', 'country', 'clickcount'].includes(query.order) ? query.order : 'name', reverse: query.order === 'clickcount' ? 'true' : 'false' };
        for (const [field, key] of Object.entries({ name: 'name', genre: 'tag', language: 'language', region: 'state', country: 'countrycode' })) if (clean(query[field])) params[key] = clean(query[field]);
        try {
            const raw = await this.browser.search(params, controller.signal);
            controller.signal.throwIfAborted();
            if (!Array.isArray(raw)) throw new Error('Directory returned an invalid response.');
            const stations = raw.slice(0, 24).map(stationFrom).filter(Boolean);
            for (const station of stations) this.stations.set(station.id, station);
            this.save(); return { stations: filterStations(distinctStations(stations.filter((s) => this.usable(s))), { sort: query.sort }).map((s) => this.public(s)), cached: false, more: raw.length >= 24 };
        } catch (error) {
            controller.signal.throwIfAborted();
            return { ...cachedPage(), warning: 'Radio directory is temporarily unavailable. Showing saved stations. Press Search to retry.' };
        }
    }
    toggleFavorite(id) { if (!this.stations.has(id)) return; if (this.favorites.has(id)) this.favorites.delete(id); else if (this.favorites.size < 500) this.favorites.add(id); this.save(); }
    addCustom(data) { if (this.favorites.size >= 500) throw new Error('Favorites list is full.'); const station = stationFrom({ name: data.name, url: data.url, custom: true }); if (!station || !clean(data.name)) throw new Error('Enter a station name and a public HTTP(S) stream URL.'); this.stations.set(station.id, station); this.favorites.add(station.id); this.save(); return station.id; }
    setFrequency(id, value) {
        if (!this.location || !this.stations.has(id)) throw new Error('Choose your location first.');
        const mhz = Number(value);
        if (!Number.isFinite(mhz) || mhz < 87.5 || mhz > 108) throw new Error('Enter the actual FM frequency, 87.5 to 108 MHz.');
        if (this.tuning.size >= 500 && !this.tuning.has(id)) throw new Error('Local tuning list is full.');
        this.tuning.set(id, { id, frequency: mhz, lat: this.location.lat, lon: this.location.lon }); this.save();
    }
    async chooseLocation(data) {
        let lat = data?.lat; let lon = data?.lon; let label = clean(data?.label); let countrycode = clean(data?.countrycode, 2);
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) throw new Error('Allow device location for the local FM dial. Online stations remain available without it.');
        lat = Math.round(lat * 100) / 100; lon = Math.round(lon * 100) / 100;
        this.location = { lat, lon, label: label || 'Device location', countrycode }; this.save();
        // Geographical station metadata is community supplied, not a reception map.
        const params = { limit: '1000', hidebroken: 'true', has_geo_info: 'true', order: 'clickcount', reverse: 'true' };
        if (/^[A-Z]{2}$/.test(countrycode)) params.countrycode = countrycode;
        try {
            const signal = AbortSignal.timeout(18000);
            for (let offset = 0; offset < (countrycode ? 4000 : 1000); offset += 1000) {
                const raw = await this.browser.search({ ...params, offset: String(offset) }, signal);
                for (const item of Array.isArray(raw) ? raw.slice(0, 1000) : []) { const station = stationFrom(item); if (station?.frequency && station.lat !== null && station.lon !== null && distanceKm(this.location, station) <= 60) this.stations.set(station.id, station); }
                if (!Array.isArray(raw) || raw.length < 1000) break;
            }
            this.save();
        } catch { /* retain known local stations and manually assigned frequencies */ }
        return this.snapshot();
    }
}
module.exports = { RadioLibrary, stationFrom, frequency, distanceKm, filterStations, distinctStations };
