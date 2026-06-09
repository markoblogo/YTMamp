#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function request(payloadUrl, method, body, token, repo) {
    const response = await fetch(payloadUrl, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': repo
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API ${method} failed: ${response.status} ${response.statusText}: ${text}`);
    }
    return response.json();
}

async function run() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.log('SKIP: GITHUB_TOKEN is not available');
        return;
    }

    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || !fs.existsSync(eventPath)) {
        console.log('SKIP: GITHUB_EVENT_PATH is missing');
        return;
    }
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    if (!event.pull_request) {
        console.log('No pull_request payload; skipping PR description update');
        return;
    }

    const summaryPath = path.join(process.cwd(), 'pr-smoke-summary.md');
    if (!fs.existsSync(summaryPath)) {
        console.log('SKIP: pr-smoke-summary.md is missing');
        return;
    }
    const summary = fs.readFileSync(summaryPath, 'utf8');

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    const pullNumber = event.pull_request.number;
    const markerStart = '<!-- YTMamp-smoke-checklist-start -->';
    const markerEnd = '<!-- YTMamp-smoke-checklist-end -->';
    const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`;

    const pr = await request(prUrl, 'GET', null, token, `${owner}/${repo}`);
    const existingBody = pr.body || '';

    const newSection = [
        markerStart,
        summary,
        markerEnd
    ].join('\n');

    const markerBlock = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, 'm');
    const nextBody = existingBody.replace(markerBlock, newSection).trim();
    const nextBodyWithSection = markerBlock.test(existingBody)
        ? nextBody
        : `${existingBody.trim() ? existingBody.trim() + '\n\n' : ''}${newSection}`;

    if (nextBodyWithSection === existingBody) {
        console.log('PR description already contains current smoke summary');
        return;
    }

    await request(prUrl, 'PATCH', { body: nextBodyWithSection }, token, `${owner}/${repo}`);
    console.log(`Updated PR #${pullNumber} description with smoke summary`);
}

run().catch((e) => {
    console.error(`[WARN] ${e.message}`);
    // best-effort: never fail CI on PR description update issues
});
