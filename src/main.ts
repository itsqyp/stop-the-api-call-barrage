import { loadConfig } from "./config.js";
import { OpenMeteoClient } from "./openMeteo.js";
import { createServer } from "./server.js";

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

const server = createServer(client);

server.listen(config.port, config.host, () => {
  console.log(`Listening on http://${config.host}:${config.port}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
