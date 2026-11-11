const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { AUDIO_TYPES } = require('./local_library');

function parseRange(header, size) {
    if (!header) return { start: 0, end: size - 1, partial: false };
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2]) || size === 0) return null;
    const first = Number(match[1]);
    const last = Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
    const start = match[1] ? first : Math.max(0, size - last);
    const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
    if (start > end || start >= size || (!match[1] && last === 0)) return null;
    return { start, end, partial: true };
}

function isInside(root, file) {
    const relative = path.relative(root, file);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Serve only queue IDs, never arbitrary paths from the renderer or an HTTP port.
function createLocalMediaHandler(resolveTrack) {
    return async (request) => {
        let handle;
        try {
            const url = new URL(request.url);
            if (url.protocol !== 'ytmamp-media:' || url.hostname !== 'audio' ||
                !/^\/[a-f0-9]{64}$/.test(url.pathname) || url.search || url.username || url.password || url.port) {
                return new Response(null, { status: 404 });
            }
            if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
            const item = resolveTrack(url.pathname.slice(1));
            if (!item) return new Response(null, { status: 404 });
            const real = await fsp.realpath(item.filePath);
            if (real !== item.filePath || !isInside(item.root, real)) return new Response(null, { status: 403 });
            const before = await fsp.stat(real);
            handle = await fsp.open(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
            const stat = await handle.stat();
            if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) {
                await handle.close();
                return new Response(null, { status: 403 });
            }
            const range = parseRange(request.headers.get('range'), stat.size);
            const headers = {
                'content-type': AUDIO_TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream',
                'accept-ranges': 'bytes', 'cache-control': 'no-store',
                'access-control-allow-origin': '*'
            };
            if (!range) {
                await handle.close();
                return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}` } });
            }
            headers['content-length'] = String(Math.max(0, range.end - range.start + 1));
            if (range.partial) headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
            const status = range.partial ? 206 : 200;
            if (request.method === 'HEAD' || stat.size === 0) {
                await handle.close();
                return new Response(null, { status, headers });
            }
            const stream = handle.createReadStream({ start: range.start, end: range.end, autoClose: true });
            const abort = () => stream.destroy();
            request.signal?.addEventListener('abort', abort, { once: true });
            stream.once('close', () => request.signal?.removeEventListener('abort', abort));
            if (request.signal?.aborted) stream.destroy();
            return new Response(Readable.toWeb(stream), { status, headers });
        } catch (error) {
            if (handle) await handle.close().catch(() => {});
            return new Response(null, { status: error.code === 'EACCES' ? 403 : 404 });
        }
    };
}

module.exports = { parseRange, createLocalMediaHandler };
