import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Batcher } from "../src/batcher.js";

describe("Batcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const upper = () =>
    vi.fn(async (keys: string[]) => keys.map((k) => k.toUpperCase()));

  it("combines calls within the window into one batch", async () => {
    const batchFetch = upper();
    const b = new Batcher<string, string>({ batchFetch, windowMs: 10 });

    const p = Promise.all([b.load("a"), b.load("b"), b.load("c")]);
    await vi.advanceTimersByTimeAsync(10);

    expect(await p).toEqual(["A", "B", "C"]);
    expect(batchFetch).toHaveBeenCalledTimes(1);
    expect(batchFetch).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("dedupes identical keys inside one window", async () => {
    const batchFetch = upper();
    const b = new Batcher<string, string>({ batchFetch, windowMs: 10 });

    const p = Promise.all([b.load("a"), b.load("a"), b.load("b")]);
    await vi.advanceTimersByTimeAsync(10);

    expect(await p).toEqual(["A", "A", "B"]);
    expect(batchFetch).toHaveBeenCalledWith(["a", "b"]);
  });

  it("flushes immediately when maxBatchSize is reached", async () => {
    const batchFetch = upper();
    const b = new Batcher<string, string>({
      batchFetch,
      windowMs: 1000,
      maxBatchSize: 2,
    });

    const results = await Promise.all([b.load("a"), b.load("b")]);

    expect(results).toEqual(["A", "B"]);
    expect(batchFetch).toHaveBeenCalledTimes(1);
  });

  it("uses a new batch for calls in a later window", async () => {
    const batchFetch = upper();
    const b = new Batcher<string, string>({ batchFetch, windowMs: 10 });

    const p1 = b.load("a");
    await vi.advanceTimersByTimeAsync(10);
    await p1;
    const p2 = b.load("b");
    await vi.advanceTimersByTimeAsync(10);
    await p2;

    expect(batchFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects every waiter when batchFetch fails", async () => {
    const batchFetch = vi.fn(async (_keys: string[]): Promise<string[]> => {
      throw new Error("boom");
    });
    const b = new Batcher<string, string>({ batchFetch, windowMs: 10 });

    const p = Promise.allSettled([b.load("a"), b.load("b")]);
    await vi.advanceTimersByTimeAsync(10);
    const results = await p;

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });

  it("rejects when result count does not match key count", async () => {
    const batchFetch = vi.fn(async (_keys: string[]) => ["only one"]);
    const b = new Batcher<string, string>({ batchFetch, windowMs: 10 });

    const p = Promise.allSettled([b.load("a"), b.load("b")]);
    await vi.advanceTimersByTimeAsync(10);
    const results = await p;

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });
});
