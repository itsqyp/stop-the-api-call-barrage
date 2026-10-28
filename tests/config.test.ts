import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses defaults when env is empty", () => {
    expect(loadConfig({})).toEqual({
      host: "0.0.0.0",
      port: 3000,
      cacheTtlMs: 300000,
      cacheMaxEntries: 500,
      batchWindowMs: 10,
      retries: 2,
    });
  });

  it("reads overrides from env", () => {
    const config = loadConfig({
      PORT: "8080",
      HOST: "127.0.0.1",
      CACHE_TTL_MS: "1000",
      BATCH_WINDOW_MS: "25",
    });
    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
    expect(config.cacheTtlMs).toBe(1000);
    expect(config.batchWindowMs).toBe(25);
  });

  it("throws on non-integer or negative values", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow("PORT");
    expect(() => loadConfig({ CACHE_TTL_MS: "-5" })).toThrow("CACHE_TTL_MS");
    expect(() => loadConfig({ RETRIES: "1.5" })).toThrow("RETRIES");
  });

  it("throws when PORT is above 65535", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow("PORT");
  });
});
