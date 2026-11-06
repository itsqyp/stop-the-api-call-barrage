import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, type ServerOptions } from "../src/server.js";
import { OpenMeteoClient } from "../src/openMeteo.js";
import { ApiKeyAuth } from "../src/auth.js";
import { RateLimiter } from "../src/rateLimiter.js";

const KEY_A = "key-aaaaaaaaaaaaaaaa";
const KEY_B = "key-bbbbbbbbbbbbbbbb";
const WEATHER = "/weather?lat=1&lon=2";

function makeFetch() {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    const lat = Number(u.searchParams.get("latitude"));
    const lon = Number(u.searchParams.get("longitude"));
    return new Response(JSON.stringify({ latitude: lat, longitude: lon }));
  });
}

describe("proxy security", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function start(options: ServerOptions) {
    const fetchFn = makeFetch();
    const client = new OpenMeteoClient({ fetchFn, windowMs: 20 });
    const server = createServer(client, options);
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
    return { base: `http://127.0.0.1:${port}`, fetchFn };
  }

  const bearer = (key: string) => ({
    headers: { Authorization: `Bearer ${key}` },
  });

  it("keeps /health open when auth is enabled", async () => {
    const { base } = await start({ auth: new ApiKeyAuth([KEY_A]) });
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("returns 401 without a key and makes no upstream call", async () => {
    const { base, fetchFn } = await start({ auth: new ApiKeyAuth([KEY_A]) });

    const res = await fetch(`${base}${WEATHER}`);

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong key", async () => {
    const { base } = await start({ auth: new ApiKeyAuth([KEY_A]) });
    const res = await fetch(`${base}${WEATHER}`, bearer("wrong-key-wrong-key"));
    expect(res.status).toBe(401);
  });

  it("accepts a valid Bearer key", async () => {
    const { base } = await start({ auth: new ApiKeyAuth([KEY_A]) });
    const res = await fetch(`${base}${WEATHER}`, bearer(KEY_A));
    expect(res.status).toBe(200);
  });

  it("accepts a valid X-API-Key header", async () => {
    const { base } = await start({ auth: new ApiKeyAuth([KEY_A]) });
    const res = await fetch(`${base}${WEATHER}`, {
      headers: { "X-API-Key": KEY_A },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a key sent in the query string", async () => {
    const { base } = await start({ auth: new ApiKeyAuth([KEY_A]) });
    const res = await fetch(`${base}${WEATHER}&api_key=${KEY_A}`);
    expect(res.status).toBe(401);
  });

  it("returns 429 with Retry-After once the limit is used up", async () => {
    const { base } = await start({
      auth: new ApiKeyAuth([KEY_A]),
      limiter: new RateLimiter({ max: 2, windowMs: 60_000 }),
    });

    const first = await fetch(`${base}${WEATHER}`, bearer(KEY_A));
    const second = await fetch(`${base}${WEATHER}`, bearer(KEY_A));
    const third = await fetch(`${base}${WEATHER}`, bearer(KEY_A));

    expect([first.status, second.status, third.status]).toEqual([
      200, 200, 429,
    ]);
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    expect(third.headers.get("retry-after")).not.toBeNull();
  });

  it("gives each key its own quota", async () => {
    const { base } = await start({
      auth: new ApiKeyAuth([KEY_A, KEY_B]),
      limiter: new RateLimiter({ max: 1, windowMs: 60_000 }),
    });

    expect((await fetch(`${base}${WEATHER}`, bearer(KEY_A))).status).toBe(200);
    expect((await fetch(`${base}${WEATHER}`, bearer(KEY_A))).status).toBe(429);
    expect((await fetch(`${base}${WEATHER}`, bearer(KEY_B))).status).toBe(200);
  });

  it("rate limits failed auth attempts per IP", async () => {
    const { base } = await start({
      auth: new ApiKeyAuth([KEY_A]),
      limiter: new RateLimiter({ max: 2, windowMs: 60_000 }),
    });

    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await fetch(`${base}${WEATHER}`)).status);
    }

    expect(statuses).toEqual([401, 401, 429]);
  });

  it("limits by IP when auth is disabled", async () => {
    const { base } = await start({
      limiter: new RateLimiter({ max: 1, windowMs: 60_000 }),
    });

    expect((await fetch(`${base}${WEATHER}`)).status).toBe(200);
    expect((await fetch(`${base}${WEATHER}`)).status).toBe(429);
  });
});
