import { describe, expect, it } from "vitest";
import type { Env } from "../env.d";
import { getSetupStatus } from "./setup";

describe("broker setup status", () => {
  it("reports missing Alpaca secrets by default without returning credentials", () => {
    const status = getSetupStatus({ ALPACA_API_KEY: "test-key" } as Env);
    expect(status).toEqual({ configured: false, broker: "alpaca", missingSecrets: ["ALPACA_API_SECRET"] });
    expect(JSON.stringify(status)).not.toContain("test-key");
  });

  it("accepts a configured Alpaca account", () => {
    expect(getSetupStatus({ ALPACA_API_KEY: "key", ALPACA_API_SECRET: "secret" } as Env).configured).toBe(true);
  });

  it("requires all three OKX credentials instead of Alpaca credentials", () => {
    expect(
      getSetupStatus({
        BROKER_PROVIDER: "okx",
        OKX_API_KEY: "key",
        OKX_API_SECRET: "secret",
        ALPACA_API_KEY: "key",
        ALPACA_API_SECRET: "secret",
      } as Env)
    ).toEqual({ configured: false, broker: "okx", missingSecrets: ["OKX_API_PASSPHRASE"] });
  });

  it("accepts a configured OKX account without Alpaca credentials", () => {
    expect(
      getSetupStatus({
        BROKER_PROVIDER: "okx",
        OKX_API_KEY: "key",
        OKX_API_SECRET: "secret",
        OKX_API_PASSPHRASE: "passphrase",
      } as Env).configured
    ).toBe(true);
  });

  it("treats blank credentials as missing", () => {
    expect(getSetupStatus({ ALPACA_API_KEY: "  ", ALPACA_API_SECRET: "" } as Env).missingSecrets).toEqual([
      "ALPACA_API_KEY",
      "ALPACA_API_SECRET",
    ]);
  });
});
