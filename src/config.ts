export interface Config {
  host: string;
  port: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  batchWindowMs: number;
  retries: number;
  apiKeys: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

type Env = Record<string, string | undefined>;

function intFrom(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: "${raw}" must be a non-negative integer`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const port = intFrom(env, "PORT", 3000);
  if (port > 65535) {
    throw new Error(`Invalid PORT: "${port}" must be at most 65535`);
  }

  const apiKeys = (env.API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (apiKeys.some((k) => k.length < 16)) {
    // The key itself is deliberately not echoed
    throw new Error(
      "Invalid API_KEYS: each key must be at least 16 characters",
    );
  }

  const rateLimitMax = intFrom(env, "RATE_LIMIT_MAX", 60);
  const rateLimitWindowMs = intFrom(env, "RATE_LIMIT_WINDOW_MS", 60_000);
  if (rateLimitMax > 0 && rateLimitWindowMs === 0) {
    throw new Error(
      "Invalid RATE_LIMIT_WINDOW_MS: must be above 0 when RATE_LIMIT_MAX is above 0",
    );
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    cacheTtlMs: intFrom(env, "CACHE_TTL_MS", 5 * 60 * 1000),
    cacheMaxEntries: intFrom(env, "CACHE_MAX_ENTRIES", 500),
    batchWindowMs: intFrom(env, "BATCH_WINDOW_MS", 10),
    retries: intFrom(env, "RETRIES", 2),
    apiKeys,
    rateLimitMax,
    rateLimitWindowMs,
  };
}
