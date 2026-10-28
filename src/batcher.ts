export interface BatcherOptions<K, V> {
  batchFetch: (keys: K[]) => Promise<V[]>;
  keyOf?: (key: K) => string;
  windowsMs?: number;
  maxBatchSize?: number;
}
