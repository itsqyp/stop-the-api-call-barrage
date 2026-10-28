import {
  createServer as createHttpServer,
  type Server,
  type ServerResponse,
} from "node:http";
import { OpenMeteoClient } from "./openMeteo.js";

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

export function createServer(client: OpenMeteoClient): Server {
  return createHttpServer(async (req, res) => {
    try {
      if (req.method !== "GET") {
        return sendJson(res, 405, { error: "Method not allowed" });
      }
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        return sendJson(res, 200, { status: "ok" });
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
