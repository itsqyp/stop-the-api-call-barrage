import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

export class ApiKeyAuth {
  private keys: Buffer[];

  constructor(keys: string[]) {
    this.keys = keys.map(digest);
  }

  get enabled(): boolean {
    return this.keys.length > 0;
  }

  /** Returns a short id for a valid key, or undefined. Never returns the key. */
  verify(candidate: string | undefined): string | undefined {
    if (candidate === undefined) return undefined;
    const d = digest(candidate);
    let match = false;
    // No early exit: time does not depend on which key matched
    for (const key of this.keys) {
      if (timingSafeEqual(key, d)) match = true;
    }
    return match ? d.toString("hex").slice(0, 12) : undefined;
  }
}

export function extractKey(headers: IncomingHttpHeaders): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m?.[1]) return m[1].trim();
  }
  const apiKey = headers["x-api-key"];
  return typeof apiKey === "string" ? apiKey.trim() : undefined;
}
