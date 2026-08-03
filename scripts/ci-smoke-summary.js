#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const summaryPath = path.join(appDir, 'ci-smoke-summary.md');
const outputPath = path.join(appDir, 'ci-smoke-output.log');

const isWindows = process.platform === 'win32';
const testCommand = isWindows ? 'npm.cmd' : 'npm';
const testArgs = ['test'];
const testResult = spawnSync(testCommand, testArgs, {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024
});

const stdout = testResult.stdout || '';
const stderr = testResult.stderr || '';
const output = [stdout, stderr].join('\n');
fs.writeFileSync(outputPath, output);

const status = Number.isInteger(testResult.status) ? testResult.status : 1;
const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const passed = lines.filter((line) => line.includes('ok')).length;
const failed = lines.filter((line) => line.includes('not ok')).length;

const summary = [
    '# Smoke integration check',
    '',
    `Run: \`${isWindows ? 'npm.cmd' : 'npm'} test\``,
    `Result: ${status === 0 ? 'PASS' : 'FAIL'}`,
    `Exit code: ${status}`,
    '',
    '| Check | Status |',
    '| --- | --- |',
    `| Test command | \`node --test && npm run test:smoke\` |`,
    `| Parsed "ok" lines | ${passed} |`,
    `| Parsed "not ok" lines | ${failed} |`,
    `| Output file | ci-smoke-output.log |`,
    `| Generated at | ${new Date().toISOString()} |`,
    '',
    '### Focus checks added in this pass',
    '- S2-05: `/events` negative contracts for `401/400/429` with `x-ytmamp-api-version` header.',
    '- S2-06: CI smoke result export (this file).',
    '',
    '### Local integration API contract matrix',
    '',
    '| Endpoint | HTTP | Required headers | Body expectation |',
    '| --- | --- | --- | --- |',
    '| `/status` | `200` | `content-type: application/json; charset=utf-8`, `x-ytmamp-api-version: 1`, `cache-control: no-store` | canonical payload (`v,status,track,state,updatedAt,windowVisible`) |',
    '| `/status` | `403` / `401` / `400` / `429` | `x-ytmamp-api-version` and either `content-type` (`text/plain`) or JSON headers as expected by branch | `forbidden` / `unauthorized` / version error / `rate limit exceeded` |',
    '| `/current-track` | `204` / `200` | `cache-control: no-store` and `x-ytmamp-api-version` | `204` has no body; `200` canonical payload |',
    '| `/current-track` | `403` / `401` / `400` / `429` | `x-ytmamp-api-version` and branch-appropriate content type | `forbidden` / `unauthorized` / version error / `rate limit exceeded` |',
    '',
    '### Raw output tail',
    '```',
    ...lines.slice(-50),
    '```'
].join('\n');

fs.writeFileSync(summaryPath, summary);

if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (status !== 0) {
    if (testResult.error) {
        console.error('[CI] Test process spawn error:', testResult.error.message);
    }
    console.error('[CI] Smoke tests failed with code:', status);
    const tail = lines.slice(-40).join('\n');
    if (tail) {
        console.error('[CI] Smoke test output tail:\n' + tail);
    }
    console.error('[CI] Smoke tests failed');
    process.exit(status);
}

console.log('Wrote ci-smoke-summary.md');
console.log(`Output persisted to ${outputPath}`);
