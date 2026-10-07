import { describe, expect, it } from "vitest";
import type { Account, Order } from "../providers/types";
import { DEFAULT_CONFIG } from "../strategy/default/config";
import { redactSecrets, toPublicAccount, toPublicConfig, toPublicLogEntry, toPublicOrder } from "./snapshot";

describe("public snapshot sanitizers", () => {
  it("redacts credentials and URLs from free text", () => {
    const text =
      "fetch failed https://api.example.com/v1?key=abc Authorization: Bearer sk-live-123 token=xyz " +
      "id=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("sk-live-123");
    expect(redacted).not.toContain("xyz");
    expect(redacted).not.toContain("api.example.com");
    expect(redacted).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
  });

  it("drops sensitive keys and nested objects from log entries", () => {
    const entry = toPublicLogEntry({
      timestamp: "2026-10-07T00:00:00Z",
      agent: "Executor",
      action: "buy_failed",
      symbol: "BTC/USD",
      notional: 250,
      error: "OKX API error (51008): Insufficient balance",
      url: "https://internal.example/hook",
      api_key: "secret",
      raw: { headers: { Authorization: "Bearer x" } },
    });

    expect(entry).toEqual({
      timestamp: "2026-10-07T00:00:00Z",
      agent: "Executor",
      action: "buy_failed",
      symbol: "BTC/USD",
      notional: 250,
      error: "OKX API error (51008): Insufficient balance",
    });
  });

  it("truncates long log strings", () => {
    const entry = toPublicLogEntry({ timestamp: "t", agent: "a", action: "b", reason: "word ".repeat(200) });
    expect((entry.reason as string).length).toBeLessThanOrEqual(300);
  });

  it("exposes only display config fields", () => {
    const config = toPublicConfig({ ...DEFAULT_CONFIG, starting_equity: 5000 });
    expect(Object.keys(config).sort()).toEqual(
      ["crypto_enabled", "crypto_symbols", "llm_model", "max_positions", "options_enabled", "starting_equity"].sort()
    );
    expect(config).not.toHaveProperty("take_profit_pct");
    expect(config).not.toHaveProperty("ticker_blacklist");
  });

  it("strips account identifiers", () => {
    const account = toPublicAccount({
      id: "acct-123",
      account_number: "PA12345",
      equity: 1000,
      cash: 400,
      buying_power: 400,
      portfolio_value: 1000,
      currency: "USD",
    } as Account);
    expect(account).toEqual({ equity: 1000, cash: 400, buying_power: 400, portfolio_value: 1000, currency: "USD" });
  });

  it("maps orders without ids", () => {
    const order = toPublicOrder({
      id: "ord-1",
      client_order_id: "approval-1",
      symbol: "ETH/USD",
      side: "buy",
      type: "market",
      order_type: "market",
      qty: "0.5",
      filled_qty: "0.5",
      filled_avg_price: "2500.5",
      status: "filled",
      submitted_at: "2026-10-07T00:00:00Z",
      created_at: "2026-10-07T00:00:00Z",
      filled_at: "2026-10-07T00:00:01Z",
    } as Order);
    expect(order).toEqual({
      symbol: "ETH/USD",
      side: "buy",
      type: "market",
      qty: 0.5,
      filled_qty: 0.5,
      filled_avg_price: 2500.5,
      status: "filled",
      submitted_at: "2026-10-07T00:00:00Z",
      filled_at: "2026-10-07T00:00:01Z",
    });
  });
});
