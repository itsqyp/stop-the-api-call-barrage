import {
  createServer as createHttpServer,
  type Server,
  type ServerResponse,
} from "node:http";
import { OpenMeteoClient } from "./openMeteo.js";
import { ApiKeyAuth, extractKey } from "./auth.js";
import { RateLimiter } from "./rateLimiter.js";

export interface ServerOptions {
  auth?: ApiKeyAuth;
  limiter?: RateLimiter;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function createServer(
  client: OpenMeteoClient,
  options: ServerOptions = {},
): Server {
  const { auth, limiter } = options;

  return createHttpServer(async (req, res) => {
    try {
      if (req.method !== "GET") {
        return sendJson(res, 405, { error: "Method not allowed" });
      }
      const url = new URL(req.url ?? "/", "http://localhost");

      // Open on purpose: Docker's health check carries no key
      if (url.pathname === "/health") {
        return sendJson(res, 200, { status: "ok" });
      }

      // Identity: the key when valid, otherwise the client IP
      let identity = `ip:${req.socket.remoteAddress ?? "unknown"}`;
      let authorized = true;
      if (auth?.enabled) {
        const keyId = auth.verify(extractKey(req.headers));
        if (keyId === undefined) authorized = false;
        else identity = `key:${keyId}`;
      }

      // Limit before rejecting auth, so failed attempts count against the IP
      if (limiter) {
        const r = limiter.check(identity);
        const resetSec = Math.ceil(r.resetMs / 1000);
        res.setHeader("RateLimit-Limit", r.limit);
        res.setHeader("RateLimit-Remaining", r.remaining);
        res.setHeader("RateLimit-Reset", resetSec);
        if (!r.allowed) {
          res.setHeader("Retry-After", resetSec);
          return sendJson(res, 429, { error: "Too many requests" });
        }
      }

      if (!authorized) {
        res.setHeader("WWW-Authenticate", "Bearer");
        return sendJson(res, 401, { error: "Unauthorized" });
      }

      if (url.pathname === "/weather") {
        const lat = parseNumber(url.searchParams.get("lat"));
        const lon = parseNumber(url.searchParams.get("lon"));
        if (lat === undefined || lon === undefined) {
          return sendJson(res, 400, {
            error: "Query params lat and lon must be numbers",
          });
        }
        const data = await client.getWeather(lat, lon);
        return sendJson(res, 200, data);
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      if (err instanceof RangeError) {
        return sendJson(res, 400, { error: err.message });
      }
      console.error("Request failed:", err);
      return sendJson(res, 502, { error: "Upstream request failed" });
    }
  });
}
