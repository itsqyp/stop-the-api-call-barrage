import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/rateLimiter.js";

describe("RateLimiter", () => {
  it("allows up to max, then blocks", () => {
    const limiter = new RateLimiter({
      max: 2,
      windowMs: 1000,
      now: () => 1000,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("reports remaining requests", () => {
    const limiter = new RateLimiter({
      max: 3,
      windowMs: 1000,
      now: () => 1000,
    });
    expect(limiter.check("a").remaining).toBe(2);
    expect(limiter.check("a").remaining).toBe(1);
    expect(limiter.check("a").remaining).toBe(0);
    expect(limiter.check("a").remaining).toBe(0);
  });

  it("resets after the window", () => {
    let t = 1000;
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, now: () => t });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    t = 2000;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("tracks identities separately", () => {
    const limiter = new RateLimiter({
      max: 1,
      windowMs: 1000,
      now: () => 1000,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("reports milliseconds until reset", () => {
    let t = 1000;
    const limiter = new RateLimiter({ max: 5, windowMs: 1000, now: () => t });
    expect(limiter.check("a").resetMs).toBe(1000);
    t = 1400;
    expect(limiter.check("a").resetMs).toBe(600);
  });

  it("evicts the oldest identity when over maxIdentities", () => {
    const limiter = new RateLimiter({
      max: 5,
      windowMs: 1000,
      maxIdentities: 2,
      now: () => 1000,
    });
    limiter.check("a");
    limiter.check("a"); // a has 2 hits
    limiter.check("b");
    limiter.check("c"); // size 3 > 2: "a" is evicted

    expect(limiter.size).toBe(2);
    // Fresh entry: 1 hit, remaining 4. A surviving "a" would show 2.
    expect(limiter.check("a").remaining).toBe(4);
  });
});
