# Local Integration API (v1)

YTMamp exposes a local HTTP API for external integrations (obsidian tools, scripts, widgets).

- Host: `127.0.0.1`
- Default port: `18880`
- Env vars:
  - `INTEGRATION_PORT` — override listening port (default `18880`)
  - `INTEGRATION_TOKEN` — optional shared token (`Bearer`, `X-YTMAMP-Token`, or `?token=...`)

## Auth

Requests must come from localhost (`127.0.0.1`) and pass optional token check:

- header: `Authorization: Bearer <token>`
- header: `X-YTMAMP-Token: <token>`
- query: `?token=<token>`

If `INTEGRATION_TOKEN` is not set, auth is disabled.

Responses:

- `401` with `WWW-Authenticate: Bearer realm="ytmamp-local"` when token missing/invalid.
- `403` for non-local requests.
- `429` for rate limit (retry after supplied in seconds).

## Rate limiting

- Window: `1000 ms`
- Limit: `20` requests / IP / 1 second
- SSE client max: `25` concurrent

## Endpoints

### `GET /status`

Returns a snapshot of app state.

**Example**

```bash
curl -s "http://127.0.0.1:18880/status"
```

**Response**

```json
{
  "v": 1,
  "status": "CONNECTED",
  "track": { "...track payload..." },
  "state": { "...playback payload..." },
  "updatedAt": 1720,
  "windowVisible": true
}
```

### `GET /current-track`

Returns only the current track payload.

**Responses**

- `204 No Content` — track not yet available
- `200 OK` — track available

**Example**

```bash
curl -s "http://127.0.0.1:18880/current-track"
```

**Response**

```json
{
  "v": 1,
  "status": "CONNECTED",
  "track": { "...track payload..." },
  "state": { "...playback payload..." },
  "updatedAt": 1720,
  "windowVisible": true
}
```

### `GET /events`

Server-Sent Events stream:

- Sends `snapshot` event immediately on connect.
- Periodic heartbeats (`: heartbeat`) every 10s.
- Push events:
  - `event: track`
  - `event: state`

**Example (curl)**

```bash
curl -N "http://127.0.0.1:18880/events"
```

**SSE frame example**

```text
event: snapshot
data: {"type":"snapshot","v":1,"payload":{...}}

event: track
data: {"type":"track","v":1,"payload":{...}}

event: state
data: {"type":"state","v":1,"payload":{...}}
```

## Notes

- `status` values are forwarded from bridge/app internals.
- Payload formats for `track` and `state` follow normalized player payloads used by UI/plugin runtime.
- No CORS/CSP headers are set in v1.

