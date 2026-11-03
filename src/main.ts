import { loadConfig } from "./config.js";
import { OpenMeteoClient } from "./openMeteo.js";
import { createServer } from "./server.js";
import { ApiKeyAuth } from "./auth.js";
import { RateLimiter } from "./rateLimiter.js";

const config = loadConfig();

const client = new OpenMeteoClient({
  windowMs: config.batchWindowMs,
  cache: {
    ttlMs: config.cacheTtlMs,
    maxEntries: config.cacheMaxEntries,
    retries: config.retries,
    retryDelayMs: 200,
    backoffFactor: 2,
    jitter: true,
  },
  fetchFn: (url) => {
    console.log("upstream:", url);
    return fetch(url);
  },
});

const auth = new ApiKeyAuth(config.apiKeys);
const limiter =
  config.rateLimitMax > 0
    ? new RateLimiter({
        max: config.rateLimitMax,
        windowMs: config.rateLimitWindowMs,
      })
    : undefined;

if (!auth.enabled)
  console.warn("WARNING: API_KEYS not set. Authentication is OFF.");
if (!limiter)
  console.warn("WARNING: RATE_LIMIT_MAX is 0. Rate limiting is OFF.");

const server = createServer(client, { auth, limiter });

server.listen(config.port, config.host, () => {
  console.log(`Listening on http://${config.host}:${config.port}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
