import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env.d";
import {
  ACTIVE_BROKER_KV_KEY,
  describeBrokers,
  getStoredBrokerOverride,
  resolveBrokerProvider,
  storeBrokerOverride,
} from "./broker";

describe("broker selection", () => {
  it("prefers the dashboard override over the env default", () => {
    const env = { BROKER_PROVIDER: "alpaca" } as Env;
    expect(resolveBrokerProvider(env)).toBe("alpaca");
    expect(resolveBrokerProvider(env, "okx")).toBe("okx");
    expect(resolveBrokerProvider({ BROKER_PROVIDER: "okx" } as Env, undefined)).toBe("okx");
  });

  it("ignores unknown values", () => {
    expect(resolveBrokerProvider({ BROKER_PROVIDER: "binance" } as unknown as Env, "nope")).toBe("alpaca");
  });

  it("describes brokers without exposing secret values", () => {
    const env = {
      ALPACA_API_KEY: "alpaca-key",
      ALPACA_API_SECRET: "alpaca-secret",
      OKX_API_KEY: "okx-key",
      OKX_SIMULATED: "true",
    } as Env;
    const info = describeBrokers(env, "okx");
    expect(info.active).toBe("okx");
    expect(info.envDefault).toBe("alpaca");
    expect(info.brokers).toEqual([
      expect.objectContaining({ id: "alpaca", configured: true, missingSecrets: [], tradingMode: "paper" }),
      expect.objectContaining({
        id: "okx",
        configured: false,
        missingSecrets: ["OKX_API_SECRET", "OKX_API_PASSPHRASE"],
        tradingMode: "paper",
      }),
    ]);
    expect(JSON.stringify(info)).not.toMatch(/alpaca-key|alpaca-secret|okx-key/);
  });

  it("round-trips the override through KV for cron and MCP", async () => {
    const store = new Map<string, string>();
    const CACHE = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => void store.set(key, value)),
      delete: vi.fn(async (key: string) => void store.delete(key)),
    };
    const env = { CACHE } as unknown as Env;

    expect(await getStoredBrokerOverride(env)).toBeNull();
    await storeBrokerOverride(env, "okx");
    expect(store.get(ACTIVE_BROKER_KV_KEY)).toBe("okx");
    expect(await getStoredBrokerOverride(env)).toBe("okx");
    await storeBrokerOverride(env, undefined);
    expect(await getStoredBrokerOverride(env)).toBeNull();
  });
});
