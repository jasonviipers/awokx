import type { Env } from "../env.d";
import { parseBoolean } from "../lib/utils";
import { createAlpacaProviders } from "./alpaca";
import { createOkxProviders } from "./okx";
import type { BrokerProvider, MarketDataProvider } from "./types";

export type BrokerProviderName = "alpaca" | "okx";

export const BROKER_PROVIDER_NAMES: readonly BrokerProviderName[] = ["alpaca", "okx"];

export interface BrokerProviders {
  name: BrokerProviderName;
  trading: BrokerProvider;
  marketData: MarketDataProvider;
}

/**
 * KV key holding the broker chosen in the dashboard. The harness writes it when the
 * config changes so cron jobs and MCP tools (which have no harness state) follow the
 * same broker. Unset means "use the BROKER_PROVIDER env default".
 */
export const ACTIVE_BROKER_KV_KEY = "settings:broker_provider";

const REQUIRED_SECRETS = {
  alpaca: ["ALPACA_API_KEY", "ALPACA_API_SECRET"],
  okx: ["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"],
} as const satisfies Record<BrokerProviderName, readonly (keyof Env)[]>;

function asBrokerName(value: string | null | undefined): BrokerProviderName | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "okx" || normalized === "alpaca" ? normalized : null;
}

/** Selected broker: dashboard override first, then the BROKER_PROVIDER env default. */
export function resolveBrokerProvider(env: Env, override?: string | null): BrokerProviderName {
  return asBrokerName(override) ?? asBrokerName(env.BROKER_PROVIDER) ?? "alpaca";
}

export function createBrokerProviders(env: Env, override?: string | null): BrokerProviders {
  const name = resolveBrokerProvider(env, override);

  if (name === "okx") {
    const okx = createOkxProviders(env);
    return { name, trading: okx.trading, marketData: okx.marketData };
  }

  const alpaca = createAlpacaProviders(env);
  return { name, trading: alpaca.trading, marketData: alpaca.marketData };
}

/** For callers outside the harness (cron, MCP): reads the dashboard choice from KV. */
export async function getStoredBrokerOverride(env: Env): Promise<BrokerProviderName | null> {
  try {
    return asBrokerName(await env.CACHE.get(ACTIVE_BROKER_KV_KEY));
  } catch {
    return null;
  }
}

export async function storeBrokerOverride(env: Env, name: BrokerProviderName | undefined): Promise<void> {
  if (name) await env.CACHE.put(ACTIVE_BROKER_KV_KEY, name);
  else await env.CACHE.delete(ACTIVE_BROKER_KV_KEY);
}

export function missingBrokerSecrets(env: Env, name: BrokerProviderName): string[] {
  return REQUIRED_SECRETS[name].filter((key) => !env[key]?.trim());
}

/** "paper" when orders go to a simulated account (Alpaca paper / OKX demo). */
export function brokerTradingMode(env: Env, name: BrokerProviderName): "paper" | "live" {
  const paper = name === "okx" ? parseBoolean(env.OKX_SIMULATED, false) : parseBoolean(env.ALPACA_PAPER, true);
  return paper ? "paper" : "live";
}

/** What the settings screen needs to offer a broker switch (no secret values). */
export function describeBrokers(env: Env, override?: string | null) {
  return {
    active: resolveBrokerProvider(env, override),
    envDefault: resolveBrokerProvider(env),
    brokers: BROKER_PROVIDER_NAMES.map((name) => {
      const missing = missingBrokerSecrets(env, name);
      return {
        id: name,
        label: name === "okx" ? "OKX (crypto spot)" : "Alpaca (stocks, options, crypto)",
        configured: missing.length === 0,
        missingSecrets: missing,
        tradingMode: brokerTradingMode(env, name),
      };
    }),
  };
}
