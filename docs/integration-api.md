# Local Integration API (v1)

YTMamp exposes a local HTTP API for external integrations (obsidian tools, scripts, widgets).

- Host: `127.0.0.1`
- Default port: `18880`
- Env vars:
  - `INTEGRATION_PORT` — override listening port (default `18880`)
  - `INTEGRATION_TOKEN` — optional shared token (`Bearer`, `X-YTMAMP-Token`, or `?token=...`)
  - `OBS_ORIGIN_ALLOWLIST` — comma-separated origins allowed to call `/obs` (for example `http://localhost:4455,https://studio.example.com`). Empty means deny all non-empty origins.

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

## API versioning

Current API contract version: `1` (`v: 1` in payloads).

Negotiation:

- Query: `?v=1`, `?api=1`, `?apiVersion=1`, `?api_version=1`
- Header: `X-YTMAMP-API-VERSION: 1`

Responses include:

- `x-ytmamp-api-version: 1`

If client requests unsupported version:

- `400 Bad Request`
- `error: "UNSUPPORTED_API_VERSION"`

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

Validation note:

- Server validates the response contract before serialization.
- In case of internal payload mismatch, response is `500` with `error: INVALID_CANONICAL_PAYLOAD`.

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

SSE envelope validation:

- `type`: event name (`snapshot|track|state`)
- `v`: contract version
- `payload`: event payload

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

**Status matrix**

| Endpoint/condition | HTTP | Headers (must include) | Body |
| --- | --- | --- | --- |
| `/events` success | `200` | `content-type: text/event-stream; charset=utf-8`, `x-ytmamp-api-version: 1`, `cache-control: no-store` | SSE stream starts with `event: snapshot` |
| `/events` non-local request | `403` | `x-ytmamp-api-version: 1`, `content-type: text/plain; charset=utf-8` | `forbidden` |
| `/events` token mismatch | `401` | `x-ytmamp-api-version: 1`, `www-authenticate: Bearer realm="ytmamp-local"` | `unauthorized` |
| `/events` unsupported API version | `400` | `x-ytmamp-api-version: 1`, `content-type: application/json; charset=utf-8`, `cache-control: no-store` | `{"v":1,"error":"UNSUPPORTED_API_VERSION",...}` |
| `/events` rate limit exceeded | `429` | `x-ytmamp-api-version: 1`, `content-type: text/plain; charset=utf-8`, `retry-after: <seconds>` | `rate limit exceeded` |
### `GET /obs`

OBS overlay endpoint with explicit allowlist/CORS policy and minimal payload:

**Response payload schema**

- `title` (string)
- `artist` (string)
- `cover` (string)
- `position` (number, integer, seconds)
- `likes` (number|null)

**Rules**

- Response includes only active track state, no nested session metadata.
- Works on same auth/local checks as other endpoints, plus origin check from allowlist.
- If active track is absent or invalid payload is produced, response is `204 No Content`.
- Disallowed/unknown origin gets `403` and no JSON body.

**Examples**

```bash
curl -H "Origin: https://studio.example.com" \
  "http://127.0.0.1:18880/obs"

curl -X OPTIONS \
  -H "Origin: https://studio.example.com" \
  -H "Access-Control-Request-Method: GET" \
  "http://127.0.0.1:18880/obs"
```

**Example success response**

```json
{
  "title": "Bohemian Rhapsody",
  "artist": "Queen",
  "cover": "https://example.com/cover.jpg",
  "position": 183,
  "likes": 12
}
```

Allowed response headers for valid OBS calls:

- `x-ytmamp-api-version: 1`
- `access-control-allow-origin: <allowed-origin>`
- `access-control-allow-credentials: true`
- `vary: Origin`
- standard `content-type: application/json; charset=utf-8`
- standard `cache-control: no-store`

## Notes

- `status` values are forwarded from bridge/app internals.
- Payload formats for `track` and `state` follow normalized player payloads used by UI/plugin runtime.
- `/status`, `/current-track`, `/events` do not set browser CORS headers.
- `/obs` sets CORS headers only for allowed origins from `OBS_ORIGIN_ALLOWLIST`.

## Last.fm scrobbling (S2-02)

YTMamp can emit Last.fm now-playing + scrobble events for local playback.

Configuration (desktop env vars):

- `LASTFM_ENABLED` — force enable (`1/true/yes/on`).
- `LASTFM_API_KEY` — Last.fm API key.
- `LASTFM_API_SECRET` — Last.fm API secret.
- `LASTFM_SESSION_KEY` — active Last.fm session key.
- `LASTFM_TRACK_THRESHOLD_SEC` — scrobble threshold, default `240`.
- `LASTFM_MIN_TRACK_DURATION_SEC` — minimum duration gate, default `30`.
- `LASTFM_PROCESS_INTERVAL_MS` — queue poll interval.
- `LASTFM_RETRY_BASE_MS` — base retry delay for transient failures.
- `LASTFM_RETRY_MAX_MS` — upper bound for exponential backoff.

Behavior:

- On track switch: `track.updateNowPlaying` is queued.
- On track progress: scrobble is queued when effective play threshold is reached.
- On stop/track change and on app shutdown: queue persists to `lastfm-scrobble-queue.json` under `userData`.
- Retry policy: retry on network/429/5xx with exponential backoff; hard failures drop from queue.
