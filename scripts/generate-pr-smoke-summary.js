#!/usr/bin/env node
const fs = require('fs');

const checklistPath = 'ci-smoke-checklist.md';
const summaryPath = 'pr-smoke-summary.md';

const checklist = fs.readFileSync(checklistPath, 'utf8');
if (!checklist || !checklist.trim()) {
    throw new Error(`[CI] Cannot generate PR smoke summary: ${checklistPath} missing or empty`);
}

const summary = [
    '# Automated smoke checklist',
    '',
    '> Generated in CI as part of v0.3.3 hardening.',
    '',
    checklist.trim(),
    '',
    '---',
    '',
    `Generated at: ${new Date().toISOString()}`,
    'Marker: `YTMamp-smoke-checklist`'
].join('\n');

fs.writeFileSync(summaryPath, summary);
if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}

console.log(`Wrote ${summaryPath}`);
