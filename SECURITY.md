# Security Policy

## Supported Versions

Only the latest version of YTMamp is supported for security updates.

## Local Communication
YTMamp uses a local WebSocket server (`127.0.0.1:18765`) to communicate between the browser extension and the desktop app. This server is configured to only accept connections from `localhost`. No data is sent to external servers.

## Reporting a Vulnerability

If you've found a security vulnerability, please report it via GitHub Issues or by contacting the maintainer directly. We aim to respond to all reports within 48 hours.
