import type { Env } from "../../env.d";
import { parseBoolean } from "../../lib/utils";
import { createOkxClient, type OkxClientConfig } from "./client";
import { resolveQuoteCcy } from "./instruments";
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
  // USDT for global accounts; USDC/USD/EUR for EEA/US accounts that hold no USDT.
  const quoteCcy = resolveQuoteCcy(env.OKX_QUOTE_CCY);

  return {
    trading: createOkxTradingProvider(client, quoteCcy),
    marketData: createOkxMarketDataProvider(client, quoteCcy),
  };
}

export { createOkxClient, OkxClient } from "./client";
export { OkxMarketDataProvider } from "./market-data";
export { OkxTradingProvider } from "./trading";
