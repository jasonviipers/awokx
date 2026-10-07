import type { Env } from "../../env.d";
import { parseBoolean } from "../../lib/utils";
import { createOkxClient, type OkxClientConfig } from "./client";
import { createOkxMarketDataProvider, type OkxMarketDataProvider } from "./market-data";
import { createOkxTradingProvider, type OkxTradingProvider } from "./trading";

export interface OkxProviders {
  trading: OkxTradingProvider;
  marketData: OkxMarketDataProvider;
}

export function createOkxProviders(env: Env): OkxProviders {
  const config: OkxClientConfig = {
    apiKey: env.OKX_API_KEY,
    apiSecret: env.OKX_API_SECRET,
    apiPassphrase: env.OKX_API_PASSPHRASE,
    baseUrl: env.OKX_API_BASE_URL || undefined,
    simulated: parseBoolean(env.OKX_SIMULATED, false),
  };

  const client = createOkxClient(config);

  return {
    trading: createOkxTradingProvider(client),
    marketData: createOkxMarketDataProvider(client),
  };
}

export { createOkxClient, OkxClient } from "./client";
export { OkxMarketDataProvider } from "./market-data";
export { OkxTradingProvider } from "./trading";
