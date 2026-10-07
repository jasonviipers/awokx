import type { Env } from "../env.d";
import { missingBrokerSecrets, resolveBrokerProvider } from "../providers/broker";

export function getSetupStatus(env: Env, brokerOverride?: string | null) {
  const broker = resolveBrokerProvider(env, brokerOverride);
  const missingSecrets = missingBrokerSecrets(env, broker);
  return { configured: missingSecrets.length === 0, broker, missingSecrets };
}
