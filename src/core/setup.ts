import type { Env } from "../env.d";
import { resolveBrokerProvider } from "../providers/broker";

export function getSetupStatus(env: Env) {
  const broker = resolveBrokerProvider(env);
  const requiredSecrets =
    broker === "okx"
      ? (["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"] as const)
      : (["ALPACA_API_KEY", "ALPACA_API_SECRET"] as const);
  const missingSecrets = requiredSecrets.filter((name) => !env[name]?.trim());
  return { configured: missingSecrets.length === 0, broker, missingSecrets };
}
