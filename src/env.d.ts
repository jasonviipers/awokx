export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ARTIFACTS: R2Bucket;
  ASSETS?: Fetcher;
  SESSION: DurableObjectNamespace;
  VIIPERS_HARNESS?: DurableObjectNamespace;

  ALPACA_API_KEY: string;
  ALPACA_API_SECRET: string;
  ALPACA_PAPER?: string;
  BROKER_PROVIDER?: "alpaca" | "okx";
  OKX_API_KEY: string;
  OKX_API_SECRET: string;
  OKX_API_PASSPHRASE: string;
  OKX_API_BASE_URL?: string;
  OKX_SIMULATED?: string;
  /** Quote currency for OKX spot pairs: USDT (default), USDC, USD or EUR. */
  OKX_QUOTE_CCY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  XAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  LLM_PROVIDER?: "openai-raw" | "ai-sdk" | "cloudflare-gateway";
  LLM_MODEL?: string;
  TWITTER_BEARER_TOKEN?: string;
  DISCORD_WEBHOOK_URL?: string;
  VIIPERS_API_TOKEN: string;
  KILL_SWITCH_SECRET: string;

  ENVIRONMENT: string;
  /** "true" exposes the read-only spectator API at /api/public/* (default off). */
  PUBLIC_DASHBOARD?: string;
  /** Optional Workers Rate Limiting binding for the public API (per client IP). */
  PUBLIC_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  FEATURE_LLM_RESEARCH: string;
  FEATURE_OPTIONS: string;

  DEFAULT_MAX_POSITION_PCT: string;
  DEFAULT_MAX_NOTIONAL_PER_TRADE: string;
  DEFAULT_MAX_DAILY_LOSS_PCT: string;
  DEFAULT_COOLDOWN_MINUTES: string;
  DEFAULT_MAX_OPEN_POSITIONS: string;
  DEFAULT_APPROVAL_TTL_SECONDS: string;
}

declare module "cloudflare:workers" {
  interface Env extends Env { }
}
