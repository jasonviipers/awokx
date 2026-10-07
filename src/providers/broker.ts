import type { Env } from "../env.d";
import { createAlpacaProviders } from "./alpaca";
import { createOkxProviders } from "./okx";
import type { BrokerProvider, MarketDataProvider } from "./types";

export type BrokerProviderName = "alpaca" | "okx";

export interface BrokerProviders {
  name: BrokerProviderName;
  trading: BrokerProvider;
  marketData: MarketDataProvider;
}

export function resolveBrokerProvider(env: Env): BrokerProviderName {
  const provider = (env.BROKER_PROVIDER || "alpaca").toLowerCase();
  return provider === "okx" ? "okx" : "alpaca";
}

export function createBrokerProviders(env: Env): BrokerProviders {
  const name = resolveBrokerProvider(env);

  if (name === "okx") {
    const okx = createOkxProviders(env);
    return { name, trading: okx.trading, marketData: okx.marketData };
  }

  const alpaca = createAlpacaProviders(env);
  return { name, trading: alpaca.trading, marketData: alpaca.marketData };
}
