import { describe, expect, it } from "vitest";
import type { Env } from "../env.d";
import { getDefaultPolicyConfig, validatePolicyConfig } from "./config";

describe("stored risk policy validation", () => {
  it("accepts the default policy", () => {
    const policy = getDefaultPolicyConfig({} as Env);
    expect(validatePolicyConfig(policy)).toEqual(policy);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite risk limits %s",
    (value) => {
      const policy = getDefaultPolicyConfig({} as Env);
      expect(() => validatePolicyConfig({ ...policy, max_notional_per_trade: value })).toThrow();
      expect(() => validatePolicyConfig({ ...policy, options: { ...policy.options, max_dte: value } })).toThrow();
    }
  );

  it("rejects malformed booleans, symbol filters and fractional position counts", () => {
    const policy = getDefaultPolicyConfig({} as Env);
    expect(() => validatePolicyConfig({ ...policy, use_cash_only: "false" })).toThrow();
    expect(() => validatePolicyConfig({ ...policy, deny_symbols: [1] })).toThrow();
    expect(() => validatePolicyConfig({ ...policy, max_open_positions: 1.5 })).toThrow();
  });
});
