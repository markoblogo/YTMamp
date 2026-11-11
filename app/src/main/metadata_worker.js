const { parentPort } = require('node:worker_threads');
const { imageMime, normalizeMetadata, MAX_ARTWORK_BYTES } = require('./metadata_reader');
let parser;
parentPort.on('message', async ({ id, filePath }) => {
    try {
        parser ||= import('music-metadata');
        const { parseFile } = await parser;
        const { common, format } = await parseFile(filePath, { duration: false, skipPostHeaders: true, skipCovers: false });
        const pictures = (common.picture || []).filter((picture) => picture.data?.length <= MAX_ARTWORK_BYTES && imageMime(picture.data));
        const picture = pictures.find((item) => /front/i.test(item.type || '')) || pictures[0];
        parentPort.postMessage({ id, result: { metadata: normalizeMetadata(common, format), picture: picture?.data || null } });
    } catch (error) {
        parentPort.postMessage({ id, error: String(error.message || error).slice(0, 200) });
    }
});
