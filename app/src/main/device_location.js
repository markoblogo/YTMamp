const path = require('node:path');
const { execFile } = require('node:child_process');
function locateMac({ resourcesPath = process.resourcesPath, appPath, packaged, execute = execFile }) {
    const binary = packaged ? path.join(resourcesPath, 'native/ytmamp-location') : path.join(appPath, 'native/bin/ytmamp-location');
    return new Promise((resolve, reject) => execute(binary, [], { timeout: 30000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
        if (error) return reject(new Error('Device location is unavailable. Check macOS Location Services and retry.'));
        try {
            const result = JSON.parse(stdout);
            if (result.error) throw new Error(result.error);
            if (!Number.isFinite(result.lat) || Math.abs(result.lat) > 90 || !Number.isFinite(result.lon) || Math.abs(result.lon) > 180) throw new Error('macOS returned an invalid location.');
            resolve({ lat: Math.round(result.lat * 100) / 100, lon: Math.round(result.lon * 100) / 100, label: String(result.label || 'Device location').slice(0, 120), countrycode: String(result.countrycode || '').slice(0, 2).toUpperCase() });
        } catch (failure) { reject(failure); }
    }));
}
module.exports = { locateMac };
