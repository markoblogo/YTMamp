#!/usr/bin/env node
const fs = require('fs');

const checklistPath = 'ci-smoke-checklist.md';
const contents = fs.readFileSync(checklistPath, 'utf8');

if (!contents || !contents.trim()) {
    console.error(`[CI] Smoke checklist is empty: ${checklistPath}`);
    process.exit(1);
}

const requiredMarkers = [
    '## Platform checks',
    '## Edge-case checks',
    '## Local Integration API checks',
    '## Browser + playback checks',
    '- [ ]',
];

const missing = requiredMarkers.filter((marker) => !contents.includes(marker));
if (missing.length > 0) {
    console.error(`[CI] Smoke checklist missing sections: ${missing.join(', ')}`);
    process.exit(1);
}

console.log(`[CI] Smoke checklist validated: ${checklistPath}`);
