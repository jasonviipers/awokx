import { describe, expect, it } from "vitest";
import { constantTimeCompare, hashObject, hmacSign, parseNumber, sanitizeForLog } from "./utils";

describe("security utilities", () => {
  it("hashes nested values rather than dropping keys absent at the root", async () => {
    expect(await hashObject({ order: { qty: 1 } })).not.toBe(await hashObject({ order: { qty: 2 } }));
  });
  it("canonicalizes nested object ordering without changing array order", async () => {
    expect(await hashObject({ a: [{ x: 1, y: 2 }] })).toBe(await hashObject({ a: [{ y: 2, x: 1 }] }));
    expect(await hashObject([1, 2])).not.toBe(await hashObject([2, 1]));
  });
  it("handles primitive and null hash inputs", async () => {
    expect(await hashObject(null)).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashObject("value")).not.toBe(await hashObject(1));
  });
  it("compares complete signatures", () => {
    expect(constantTimeCompare("abc", "abc")).toBe(true);
    expect(constantTimeCompare("abc", "abd")).toBe(false);
    expect(constantTimeCompare("abc", "ab")).toBe(false);
  });
  it("refuses to sign with an empty secret", async () => {
    await expect(hmacSign("order", "")).rejects.toThrow("not configured");
  });
  it("redacts mixed-case credentials and preserves arrays", () => {
    expect(
      sanitizeForLog({
        apiKey: "secret",
        rows: [{ passphrase: "secret", symbol: "BTC/USD" }],
        "OK-ACCESS-KEY": "secret",
      })
    ).toEqual({
      apiKey: "[REDACTED]",
      rows: [{ passphrase: "[REDACTED]", symbol: "BTC/USD" }],
      "OK-ACCESS-KEY": "[REDACTED]",
    });
  });
  it("ignores non-finite numeric configuration", () => {
    expect(parseNumber("Infinity", 10)).toBe(10);
    expect(parseNumber("20", 10)).toBe(20);
  });
});
