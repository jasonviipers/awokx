import { type PolicyConfig, validatePolicyConfig } from "../../../policy/config";
import type { D1Client, PolicyConfigRow } from "../client";

export async function getPolicyConfig(db: D1Client): Promise<PolicyConfig | null> {
  const row = await db.executeOne<PolicyConfigRow>(`SELECT * FROM policy_config WHERE id = 1`);

  if (!row) {
    return null;
  }

  return validatePolicyConfig(JSON.parse(row.config_json));
}
