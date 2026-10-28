import { RequestCache, type CacheOptions } from "./cache.js";
import { Batcher } from "./batcher.js";

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface OpenMeteoOptions {
  baseUrl?: string;
  /** Extra query params, same for every request from this client */
  params?: Record<string, string>;
  windowMs?: number;
  maxBatchSize?: number;
  /** Decimal places kept when rounding coordinates (default 2) */
  precision?: number;
  cache?: CacheOptions;
  fetchFn?: (url: string) => Promise<Response>;
}

export class OpenMeteoClient {
  private cache: RequestCache;
  private batcher: Batcher<Coordinate, unknown>;
  private baseUrl: string;
  private params: Record<string, string>;
  private precision: number;
  private fetchFn: (url: string) => Promise<Response>;

  constructor(options: OpenMeteoOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.open-meteo.com/v1/forecast";
    this.params = options.params ?? {
      current: "temperature_2m,wind_speed_10m",
    };
    this.precision = options.precision ?? 2;
    this.fetchFn = options.fetchFn ?? ((url) => fetch(url));
    this.cache = new RequestCache(options.cache);
    this.batcher = new Batcher<Coordinate, unknown>({
      batchFetch: (coords) => this.fetchBatch(coords),
      keyOf: (c) => `${c.latitude},${c.longitude}`,
      windowMs: options.windowMs,
      maxBatchSize: options.maxBatchSize,
    });
  }

  async getWeather<T = unknown>(
    latitude: number,
    longitude: number,
  ): Promise<T> {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new RangeError(`Invalid latitude: ${latitude}`);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new RangeError(`Invalid longitude: ${longitude}`);
    }

    const coord: Coordinate = {
      latitude: this.round(latitude),
      longitude: this.round(longitude),
    };
    const key = `${coord.latitude},${coord.longitude}`;
    return this.cache.fetch(key, () => this.batcher.load(coord)) as Promise<T>;
  }

  private round(n: number): number {
    return Number(n.toFixed(this.precision));
  }

  private async fetchBatch(coords: Coordinate[]): Promise<unknown[]> {
    const search = new URLSearchParams({
      latitude: coords.map((c) => c.latitude).join(","),
      longitude: coords.map((c) => c.longitude).join(","),
      ...this.params,
    });
    const res = await this.fetchFn(`${this.baseUrl}?${search.toString()}`);
    if (!res.ok) {
      throw new Error(`Open-Meteo request failed: HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    // One location returns an object, several return an array
    return Array.isArray(json) ? json : [json];
  }
}
