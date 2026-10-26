export type Fetcher<T> = () => Promise<T>;

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  retries?: number;
  retryDelayMs?: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RequestCache {
  // Map keeps insertion order: first key = least recently used
  private cache = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private ttlMs: number;
  private maxEntries: number;
  private retries: number;
  private retryDelayMs: number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 500;
    this.retries = options.retries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 200;
  }

  get size(): number {
    return this.cache.size;
  }

  async fetch<T>(key: string, fetcher: Fetcher<T>): Promise<T> {
    const entry = this.cache.get(key);
    if (entry) {
      if (Date.now() < entry.expiresAt) {
        // Mark as recently used: delete and re-insert at the end
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data as T;
      }
      this.cache.delete(key);
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = this.runWithRetry(fetcher)
      .then((data) => {
        this.set(key, data);
        return data;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
  }

  private set<T>(key: string, data: T): void {
    this.cache.delete(key);
    this.cache.set(key, { data, expiresAt: Date.now() + this.ttlMs });
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async runWithRetry<T>(fetcher: Fetcher<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await fetcher();
      } catch (err) {
        lastError = err;
        if (attempt < this.retries) await sleep(this.retryDelayMs);
      }
    }
    throw lastError;
  }
}
