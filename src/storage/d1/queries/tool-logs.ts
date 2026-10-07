import { generateId, hashObject, nowISO, sanitizeForLog } from "../../../lib/utils";
import type { D1Client } from "../client";

export async function insertToolLog(
  db: D1Client,
  entry: {
    request_id: string;
    tool_name: string;
    input: unknown;
    output?: unknown;
    error?: unknown;
    latency_ms?: number;
    provider_calls?: number;
  }
): Promise<string> {
  const id = generateId();
  const inputJson = JSON.stringify(sanitizeForLog(entry.input));
  const inputHash = await hashObject(entry.input);

  await db.run(
    `INSERT INTO tool_logs (id, request_id, tool_name, input_hash, input_json, output_json, error_json, latency_ms, provider_calls, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.request_id,
      entry.tool_name,
      inputHash,
      inputJson,
      entry.output ? JSON.stringify(sanitizeForLog(entry.output)) : null,
      entry.error ? JSON.stringify(sanitizeForLog(entry.error)) : null,
      entry.latency_ms ?? null,
      entry.provider_calls ?? 0,
      nowISO(),
    ]
  );

  return id;
}
