export interface BatcherOptions<K, V> {
  batchFetch: (keys: K[]) => Promise<V[]>;
  keyOf?: (key: K) => string;
  windowMs?: number;
  maxBatchSize?: number;
}

interface Waiter<V> {
  resolve: (value: V) => void;
  reject: (error: unknown) => void;
}

interface Pending<K, V> {
  key: K;
  waiters: Waiter<V>[];
}

export class Batcher<K, V> {
  private queue = new Map<string, Pending<K, V>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private batchFetch: (keys: K[]) => Promise<V[]>;
  private keyOf: (key: K) => string;
  private windowMs: number;
  private maxBatchSize: number;

  constructor(options: BatcherOptions<K, V>) {
    this.batchFetch = options.batchFetch;
    this.keyOf = options.keyOf ?? ((k) => String(k));
    this.windowMs = options.windowMs ?? 10;
    this.maxBatchSize = options.maxBatchSize ?? 100;
  }

  load(key: K): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      const id = this.keyOf(key);
      const existing = this.queue.get(id);
      if (existing) {
        existing.waiters.push({ resolve, reject });
      } else {
        this.queue.set(id, { key, waiters: [{ resolve, reject }] });
      }

      if (this.queue.size >= this.maxBatchSize) {
        this.flush();
      } else if (this.timer === undefined) {
        this.timer = setTimeout(() => this.flush(), this.windowMs);
      }
    });
  }

  private flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const batch = [...this.queue.values()];
    this.queue = new Map();
    if (batch.length === 0) return;

    Promise.resolve()
      .then(() => this.batchFetch(batch.map((p) => p.key)))
      .then((results) => {
        if (results.length !== batch.length) {
          throw new Error(
            `Batch size mismatch: expected ${batch.length}, got ${results.length}`,
          );
        }
        batch.forEach((pending, i) => {
          const result = results[i] as V;
          pending.waiters.forEach((w) => w.resolve(result));
        });
      })
      .catch((err) => {
        batch.forEach((pending) =>
          pending.waiters.forEach((w) => w.reject(err)),
        );
      });
  }
}
