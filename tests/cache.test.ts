import { describe, it, expect, vi } from "vitest";
import { RequestCache } from "../src/cache.js";

describe("RequestCache", () => {
  it("waits with exponential backoff between retries", async () => {
    vi.useFakeTimers();
    const cache = new RequestCache({
      retries: 3,
      retryDelayMs: 100,
      backoffFactor: 2,
    });
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockRejectedValueOnce(new Error("3"))
      .mockResolvedValueOnce("ok");

    const promise = cache.fetch("a", fetcher);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(99); // before 1st delay (100)
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(199); // before 2nd delay (200)
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(399); // before 3rd delay (400)
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(4);

    await expect(promise).resolves.toBe("ok");
    vi.useRealTimers();
  });

  it("caps the delay at maxRetryDelayMs", async () => {
    vi.useFakeTimers();
    const cache = new RequestCache({
      retries: 2,
      retryDelayMs: 100,
      backoffFactor: 10,
      maxRetryDelayMs: 150,
    });
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");

    const promise = cache.fetch("a", fetcher);

    await vi.advanceTimersByTimeAsync(100); // 1st delay: 100
    expect(fetcher).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(149); // 2nd delay: 1000 capped to 150
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(3);

    await expect(promise).resolves.toBe("ok");
    vi.useRealTimers();
  });

  it("applies jitter: delay is random()*computed", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const cache = new RequestCache({
      retries: 1,
      retryDelayMs: 100,
      jitter: true,
    });
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("1"))
      .mockResolvedValueOnce("ok");

    const promise = cache.fetch("a", fetcher);

    await vi.advanceTimersByTimeAsync(49); // 0.5 * 100 = 50
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toBe("ok");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
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
