import { describe, it, expect, vi } from "vitest";
import { RequestCache } from "../src/cache.js";

describe("RequestCache", () => {
  it("evicts the least recently used entry when over maxEntries", async () => {
    const cache = new RequestCache({ ttlMs: 1000, maxEntries: 2 });
    const fetcher = vi.fn(async () => "data");

    await cache.fetch("a", fetcher);
    await cache.fetch("b", fetcher);
    await cache.fetch("a", fetcher); // touch "a": "b" is now oldest
    await cache.fetch("c", fetcher); // evicts "b"

    expect(cache.size).toBe(2);
    fetcher.mockClear();

    await cache.fetch("a", fetcher); // still cached
    expect(fetcher).toHaveBeenCalledTimes(0);
    await cache.fetch("b", fetcher); // evicted: refetch
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries failed fetches up to the retry limit", async () => {
    const cache = new RequestCache({ retries: 2, retryDelayMs: 1 });
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("ok");

    await expect(cache.fetch("a", fetcher)).resolves.toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after retries are exhausted", async () => {
    const cache = new RequestCache({ retries: 1, retryDelayMs: 1 });
    const fetcher = vi.fn(async () => {
      throw new Error("always fails");
    });

    await expect(cache.fetch("a", fetcher)).rejects.toThrow("always fails");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares one retry sequence across concurrent callers", async () => {
    const cache = new RequestCache({ retries: 1, retryDelayMs: 1 });
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    const results = await Promise.all([
      cache.fetch("a", fetcher),
      cache.fetch("a", fetcher),
    ]);

    expect(results).toEqual(["ok", "ok"]);
    expect(fetcher).toHaveBeenCalledTimes(2); // 1 fail + 1 success, not per caller
  });
  it("fires one fetch for concurrent calls with the same key", async () => {
    const cache = new RequestCache({ ttlMs: 1000 });
    const fetcher = vi.fn(async () => "data");

    const results = await Promise.all([
      cache.fetch("a", fetcher),
      cache.fetch("a", fetcher),
      cache.fetch("a", fetcher),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toEqual(["data", "data", "data"]);
  });

  it("serves from cache within TTL", async () => {
    const cache = new RequestCache({ ttlMs: 1000 });
    const fetcher = vi.fn(async () => "data");

    await cache.fetch("a", fetcher);
    await cache.fetch("a", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires", async () => {
    vi.useFakeTimers();
    const cache = new RequestCache({ ttlMs: 1000 });
    const fetcher = vi.fn(async () => "data");

    await cache.fetch("a", fetcher);
    vi.advanceTimersByTime(1001);
    await cache.fetch("a", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not cache failures and cleans up in-flight state", async () => {
    const cache = new RequestCache({ ttlMs: 1000 });
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    await expect(cache.fetch("a", fetcher)).rejects.toThrow("fail");
    await expect(cache.fetch("a", fetcher)).resolves.toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses separate entries for different keys", async () => {
    const cache = new RequestCache({ ttlMs: 1000 });
    const fetcher = vi.fn(async () => "data");

    await Promise.all([cache.fetch("a", fetcher), cache.fetch("b", fetcher)]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
