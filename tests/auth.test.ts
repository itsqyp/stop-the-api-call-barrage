import { describe, it, expect } from "vitest";
import { ApiKeyAuth, extractKey } from "../src/auth.js";

describe("ApiKeyAuth", () => {
  it("accepts a valid key and returns a stable id", () => {
    const auth = new ApiKeyAuth([
      "key-one-aaaaaaaaaaaa",
      "key-two-bbbbbbbbbbbb",
    ]);
    const id1 = auth.verify("key-one-aaaaaaaaaaaa");
    const id2 = auth.verify("key-one-aaaaaaaaaaaa");
    const id3 = auth.verify("key-two-bbbbbbbbbbbb");

    expect(id1).toHaveLength(12);
    expect(id1).toBe(id2);
    expect(id3).not.toBe(id1);
    expect(id1).not.toContain("key-one");
  });

  it("rejects wrong or missing keys", () => {
    const auth = new ApiKeyAuth(["key-one-aaaaaaaaaaaa"]);
    expect(auth.verify("wrong")).toBeUndefined();
    expect(auth.verify("")).toBeUndefined();
    expect(auth.verify(undefined)).toBeUndefined();
  });

  it("accepts any of several keys", () => {
    const auth = new ApiKeyAuth([
      "key-one-aaaaaaaaaaaa",
      "key-two-bbbbbbbbbbbb",
    ]);
    expect(auth.verify("key-two-bbbbbbbbbbbb")).toBeDefined();
  });

  it("is disabled when there are no keys", () => {
    expect(new ApiKeyAuth([]).enabled).toBe(false);
    expect(new ApiKeyAuth(["key-one-aaaaaaaaaaaa"]).enabled).toBe(true);
  });
});

describe("extractKey", () => {
  it("reads a Bearer token", () => {
    expect(extractKey({ authorization: "Bearer abc123" })).toBe("abc123");
  });

  it("treats the Bearer scheme case-insensitively", () => {
    expect(extractKey({ authorization: "bearer abc123" })).toBe("abc123");
  });

  it("reads x-api-key", () => {
    expect(extractKey({ "x-api-key": "abc123" })).toBe("abc123");
  });

  it("returns undefined when no key is present", () => {
    expect(extractKey({})).toBeUndefined();
    expect(extractKey({ authorization: "Basic abc123" })).toBeUndefined();
  });
});
