import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenMeteoClient } from "../src/openMeteo.js";

// Fake API: echoes requested coordinates. Object for 1 location, array for many.
function makeFetch() {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    const lats = (u.searchParams.get("latitude") ?? "").split(",");
    const lons = (u.searchParams.get("longitude") ?? "").split(",");
    const body = lats.map((lat, i) => ({
      latitude: Number(lat),
      longitude: Number(lons[i]),
    }));
    return new Response(JSON.stringify(body.length === 1 ? body[0] : body));
  });
}

describe("OpenMeteoClient", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one request for many concurrent locations", async () => {
    const fetchFn = makeFetch();
    const client = new OpenMeteoClient({ fetchFn, windowMs: 10 });

    const p = Promise.all([
      client.getWeather<{ latitude: number }>(52.52, 13.41),
      client.getWeather<{ latitude: number }>(48.85, 2.35),
      client.getWeather<{ latitude: number }>(40.71, -74.01),
    ]);
    await vi.advanceTimersByTimeAsync(10);
    const results = await p;

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0]![0]);
    expect(url.searchParams.get("latitude")).toBe("52.52,48.85,40.71");
    expect(url.searchParams.get("longitude")).toBe("13.41,2.35,-74.01");
    expect(results.map((r) => r.latitude)).toEqual([52.52, 48.85, 40.71]);
  });

  it("dedupes the same location and serves repeats from cache", async () => {
    const fetchFn = makeFetch();
    const client = new OpenMeteoClient({ fetchFn, windowMs: 10 });

    const p = Promise.all([
      client.getWeather(52.52, 13.41),
      client.getWeather(52.52, 13.41),
      client.getWeather(52.52, 13.41),
    ]);
    await vi.advanceTimersByTimeAsync(10);
    await p;
    await client.getWeather(52.52, 13.41); // cache hit, no timer needed

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rounds coordinates so near-identical points share one entry", async () => {
    const fetchFn = makeFetch();
    const client = new OpenMeteoClient({ fetchFn, windowMs: 10, precision: 2 });

    const p = Promise.all([
      client.getWeather(52.521, 13.411),
      client.getWeather(52.524, 13.414),
    ]);
    await vi.advanceTimersByTimeAsync(10);
    await p;

    const url = new URL(fetchFn.mock.calls[0]![0]);
    expect(url.searchParams.get("latitude")).toBe("52.52");
    expect(url.searchParams.get("longitude")).toBe("13.41");
  });

  it("rejects invalid coordinates without a request", async () => {
    const fetchFn = makeFetch();
    const client = new OpenMeteoClient({ fetchFn });

    await expect(client.getWeather(91, 0)).rejects.toThrow("latitude");
    await expect(client.getWeather(0, 181)).rejects.toThrow("longitude");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws on a non-OK HTTP status", async () => {
    const fetchFn = vi.fn(
      async (_url: string) => new Response("bad", { status: 400 }),
    );
    const client = new OpenMeteoClient({ fetchFn, windowMs: 10 });

    const assertion = expect(client.getWeather(1, 1)).rejects.toThrow("400");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it("retries a failed batch through the cache options", async () => {
    const good = makeFetch();
    const fetchFn = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockImplementation(good);
    const client = new OpenMeteoClient({
      fetchFn,
      windowMs: 10,
      cache: { retries: 1, retryDelayMs: 1 },
    });

    const p = client.getWeather<{ latitude: number }>(1, 1);
    await vi.advanceTimersByTimeAsync(50);

    expect((await p).latitude).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
