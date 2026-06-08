const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['app/src', 'app/scripts', 'app/test', 'extension/src', 'extension/popup'];

function collectJsFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectJsFiles(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const files = DIRS.flatMap((dir) => collectJsFiles(path.join(ROOT, dir)));
let failed = false;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        console.error(result.stderr || result.stdout);
    }
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);
