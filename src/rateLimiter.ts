export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  maxIdentities?: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private hits = new Map<string, Entry>();
  private max: number;
  private windowMs: number;
  private maxIdentities: number;
  private now: () => number;

  constructor(options: RateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.maxIdentities = Math.max(1, options.maxIdentities ?? 10_000);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.hits.size;
  }

  check(identity: string): RateLimitResult {
    const t = this.now();
    let entry = this.hits.get(identity);

    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + this.windowMs };
      this.hits.delete(identity);
      this.hits.set(identity, entry);
      this.prune(t);
    }

    entry.count++;
    return {
      allowed: entry.count <= this.max,
      limit: this.max,
      remaining: Math.max(0, this.max - entry.count),
      resetMs: entry.resetAt - t,
    };
  }

  // Bounds memory: drop expired entries, then the oldest ones
  private prune(t: number): void {
    if (this.hits.size <= this.maxIdentities) return;
    for (const [id, entry] of this.hits) {
      if (t >= entry.resetAt) this.hits.delete(id);
    }
    while (this.hits.size > this.maxIdentities) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }
}
