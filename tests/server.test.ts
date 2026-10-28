import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import { OpenMeteoClient } from "../src/openMeteo.js";

// Fake upstream: echoes coordinates. Object for 1 location, array for many.
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

describe("proxy server", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function start(fetchFn: (url: string) => Promise<Response>) {
    const client = new OpenMeteoClient({ fetchFn, windowMs: 100 });
    const server = createServer(client);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    return `http://127.0.0.1:${port}`;
  }

  it("answers /health", async () => {
    const base = await start(makeFetch());
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("makes one upstream call for 10 parallel requests to one location", async () => {
    const fetchFn = makeFetch();
    const base = await start(fetchFn);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => fetch(`${base}/weather?lat=10&lon=20`)),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("batches different locations into one upstream call", async () => {
    const fetchFn = makeFetch();
    const base = await start(fetchFn);
    const spots = [
      [1, 2],
      [3, 4],
      [5, 6],
    ] as const;

    const responses = await Promise.all(
      spots.map(([lat, lon]) => fetch(`${base}/weather?lat=${lat}&lon=${lon}`)),
    );
    const bodies = await Promise.all(
      responses.map((r) => r.json() as Promise<{ latitude: number }>),
    );

    expect(bodies.map((b) => b.latitude)).toEqual([1, 3, 5]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0]![0]);
    // arrival order at the server may vary, so compare sorted
    expect((url.searchParams.get("latitude") ?? "").split(",").sort()).toEqual([
      "1",
      "3",
      "5",
    ]);
  });

  it.each([
    ["missing lon", "lat=1"],
    ["empty lat", "lat=&lon=1"],
    ["non-numeric lat", "lat=abc&lon=1"],
    ["lat out of range", "lat=91&lon=0"],
    ["lon out of range", "lat=0&lon=181"],
  ])("returns 400 for %s and makes no upstream call", async (_name, query) => {
    const fetchFn = makeFetch();
    const base = await start(fetchFn);

    const res = await fetch(`${base}/weather?${query}`);

    expect(res.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown paths", async () => {
    const base = await start(makeFetch());
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("returns 405 for non-GET methods", async () => {
    const base = await start(makeFetch());
    const res = await fetch(`${base}/weather?lat=1&lon=1`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("returns 502 when the upstream fails", async () => {
    const fetchFn = vi.fn(
      async (_url: string) => new Response("x", { status: 500 }),
    );
    const base = await start(fetchFn);

    const res = await fetch(`${base}/weather?lat=5&lon=5`);

    expect(res.status).toBe(502);
  });
});
