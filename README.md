# Stop The API Call Barrages

A small TypeScript package and proxy service that stops many callers from hitting the same external API at once. It is built around the Open-Meteo weather API.

When many components ask for the same data at the same time, this project:

1. Merges identical in-flight requests into one.
2. Serves repeat requests from an in-memory cache.
3. Batches different locations into a single multi-location request.

Example: 50 parallel requests for 5 locations produce 1 upstream HTTP call. Repeating them within the cache TTL produces 0.

## How it works

caller -> RequestCache -> Batcher -> OpenMeteoClient -> Open-Meteo API
(cache hit, (collect (one URL with
or join an calls for many coordinates)
in-flight a short
request) window)

- **RequestCache**: in-flight deduplication, TTL cache, LRU size limit, retries with exponential backoff and optional jitter. Failures are never cached.
- **Batcher**: collects calls made within a short window (default 10 ms), removes duplicate keys, sends one batch request, and returns each caller its own result.
- **OpenMeteoClient**: validates and rounds coordinates, then builds one request with comma-separated coordinates. One location returns an object, several return an array, and the client handles both.
- **Proxy server**: plain `node:http` server around the client, with API key auth and rate limiting.

## Requirements

- Node.js 26 (the Docker image uses `node:26-slim`)
- npm
- Docker and Docker Compose (optional, for the container)

## Project structure

src/
cache.ts RequestCache (dedup, TTL, LRU, retry)
batcher.ts Generic Batcher
openMeteo.ts OpenMeteoClient
config.ts Environment variable parsing and validation
auth.ts API key verification
rateLimiter.ts Fixed-window rate limiter
server.ts HTTP server and routes
main.ts Service entry point
index.ts Public library exports
tests/ Vitest tests
examples/
demo.ts Library demo (real network)
barrage.ts Load script against the running proxy
Dockerfile
docker-compose.yml
tsconfig.json Type-checks src, tests and examples (no output)
tsconfig.build.json Build config (src only, outputs to dist)

## Quick start with Docker

1. Create a key (64 hex characters):

   node -e "import('node:crypto').then(c=>console.log(c.randomBytes(32).toString('hex')))"

2. Copy `.env.example` to `.env` and set the key:

   API_KEYS=paste-the-key-here

3. Start the service:

   docker compose up --build -d
   docker compose ps

   Wait for the status `healthy` (about 15 to 20 seconds).

4. Call it:

   curl -H "Authorization: Bearer YOUR_KEY" "http://127.0.0.1:3000/weather?lat=23.81&lon=90.41"

   On Windows PowerShell use `curl.exe`, because plain `curl` is an alias for `Invoke-WebRequest`.

5. Stop it:

   docker compose down

Use `--build` only after changing code. Without code changes, `docker compose up -d` reuses the existing image.

Compose refuses to start if `API_KEYS` is empty. The port is bound to `127.0.0.1` on the host, so the service is reachable only from the same machine.

## Run without Docker

npm install
npm run dev

Build and run the compiled output:

npm run build
npm start

If `API_KEYS` is not set, the service starts with authentication off and prints a warning.

## Configuration

All settings are environment variables. Invalid values stop the service at startup.

| Variable               | Default   | Description                                                                    |
| ---------------------- | --------- | ------------------------------------------------------------------------------ |
| `PORT`                 | `3000`    | Listen port (0 to 65535)                                                       |
| `HOST`                 | `0.0.0.0` | Listen address                                                                 |
| `CACHE_TTL_MS`         | `300000`  | Cache lifetime in milliseconds (5 minutes)                                     |
| `CACHE_MAX_ENTRIES`    | `500`     | Maximum cached locations (LRU eviction)                                        |
| `BATCH_WINDOW_MS`      | `10`      | How long to collect calls before one batch request                             |
| `RETRIES`              | `2`       | Retries for failed upstream requests                                           |
| `API_KEYS`             | empty     | Comma-separated API keys, each at least 16 characters. Empty means auth is off |
| `RATE_LIMIT_MAX`       | `60`      | Requests allowed per window per identity. `0` disables rate limiting           |
| `RATE_LIMIT_WINDOW_MS` | `60000`   | Rate limit window in milliseconds                                              |

Retries use exponential backoff (factor 2, 200 ms base) with jitter.

## API

| Route                                    | Description                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /health`                            | Returns `{"status":"ok"}`. No key needed, no rate limit. Used by the Docker health check |
| `GET /weather?lat=<number>&lon=<number>` | Returns the Open-Meteo JSON for the location. Requires a key when `API_KEYS` is set      |

Status codes:

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 200  | Success                                             |
| 400  | Missing, non-numeric or out-of-range `lat` or `lon` |
| 401  | Missing or invalid API key                          |
| 404  | Unknown path                                        |
| 405  | Method other than GET                               |
| 429  | Rate limit exceeded. See the `Retry-After` header   |
| 502  | Upstream request failed                             |

## Authentication and rate limiting

- Send the key as `Authorization: Bearer <key>` or `X-API-Key: <key>`. Keys in the query string are not accepted, because URLs end up in logs.
- Keys are compared by SHA-256 digest with a constant-time comparison.
- Rate limits are counted per API key. Requests with a missing or wrong key are counted per client IP, which limits key guessing.
- Responses include `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`.
- To rotate keys, edit `.env` and run `docker compose up -d`.

## Use as a library

Deduplicating cache for any async function:

```ts
import { RequestCache } from "./src/index.js";

const cache = new RequestCache({
  ttlMs: 60_000,
  maxEntries: 200,
  retries: 2,
  retryDelayMs: 200,
  backoffFactor: 2,
  jitter: true,
});

// Three simultaneous calls with the same key run the fetcher once.
const [a, b, c] = await Promise.all([
  cache.fetch("user:1", () => loadUser(1)),
  cache.fetch("user:1", () => loadUser(1)),
  cache.fetch("user:1", () => loadUser(1)),
]);
```

Open-Meteo client with batching:

```ts
import { OpenMeteoClient } from "./src/index.js";

const client = new OpenMeteoClient();

// All three calls become one HTTP request with three coordinate pairs.
const [dhaka, berlin, paris] = await Promise.all([
  client.getWeather(23.81, 90.41),
  client.getWeather(52.52, 13.41),
  client.getWeather(48.85, 2.35),
]);
```

Coordinates are rounded to 2 decimals by default (`precision` option), so near-identical points share one cache entry.

## Demos

Library demo against the real API (prints one upstream request for 4 calls):

npx tsx examples/demo.ts

Load test against the running proxy (50 parallel requests, 5 locations):

```
# Windows PowerShell
$env:API_KEY="YOUR_KEY"; npx tsx examples/barrage.ts

# Linux / macOS
API_KEY=YOUR_KEY npx tsx examples/barrage.ts
```

Check the service log:

```
docker compose logs weather-proxy
```

Expected: one `upstream:` line containing all 5 locations. Run the load test again within the cache TTL and no new `upstream:` lines appear. Running it again quickly may return some 429 responses, which is the rate limiter working.

## Development

```
npm test           run all tests once
npm run test:watch run tests on file changes
npx tsc --noEmit   type-check src, tests and examples
npm run build      compile src to dist
```

## Docker details

- Multi-stage build: compile in one stage, run only `dist/` in the final stage.
- No runtime dependencies are installed, so the final image holds only compiled code and `package.json`.
- Runs as the non-root `node` user, with a read-only filesystem and all Linux capabilities dropped.
- The health check calls `/health` inside the container.

## Notes and limitations

- The cache and rate limit counters live in memory, per process. Several containers would each keep their own.
- A fixed-window limiter allows up to twice the limit around a window boundary.
- One failing batch rejects every caller in that batch. Coordinates are validated before queuing to reduce this.
- Open-Meteo returns data for the nearest grid cell, so the returned coordinates can differ slightly from the request.
- Without a `timezone` parameter, Open-Meteo times are in GMT.
- There is no HTTPS. Keys travel in clear text unless a TLS-terminating proxy sits in front.
- There are no CORS headers, so browser pages on another origin cannot call the proxy directly.
- Check the Open-Meteo terms of use for your use case.

## Roadmap

- CORS support
- GitHub Actions workflow running tests and the Docker build

## License

ISC (as set in `package.json`).
