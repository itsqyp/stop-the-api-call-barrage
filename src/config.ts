export interface Config {
  host: string;
  port: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  batchWindowMs: number;
  retries: number;
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
  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    cacheTtlMs: intFrom(env, "CACHE_TTL_MS", 5 * 60 * 1000),
    cacheMaxEntries: intFrom(env, "CACHE_MAX_ENTRIES", 500),
    batchWindowMs: intFrom(env, "BATCH_WINDOW_MS", 10),
    retries: intFrom(env, "RETRIES", 2),
  };
}
