import { nowISO } from "../../../lib/utils";
import type { OrderPreview, PolicyResult } from "../../../mcp/types";
import type { D1Client, OrderApprovalRow } from "../client";

export interface CreateApprovalParams {
  id: string;
  preview: OrderPreview;
  policyResult: PolicyResult;
  previewHash: string;
  approvalToken: string;
  expiresAt: string;
}

export async function createApproval(db: D1Client, params: CreateApprovalParams): Promise<string> {
  const id = params.id;

  await db.run(
    `INSERT INTO order_approvals (id, preview_hash, order_params_json, policy_result_json, approval_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.previewHash,
      JSON.stringify(params.preview),
      JSON.stringify(params.policyResult),
      params.approvalToken,
      params.expiresAt,
      nowISO(),
    ]
  );

  return id;
}

export async function getApprovalByToken(db: D1Client, token: string): Promise<OrderApprovalRow | null> {
  return db.executeOne<OrderApprovalRow>(`SELECT * FROM order_approvals WHERE approval_token = ?`, [token]);
}

/**
 * Atomically claim an approval. Returns false if it was already used, so two
 * concurrent submits of the same token can never both place an order.
 */
export async function markApprovalUsed(db: D1Client, approvalId: string): Promise<boolean> {
  const result = await db.run(`UPDATE order_approvals SET used_at = ? WHERE id = ? AND used_at IS NULL`, [
    nowISO(),
    approvalId,
  ]);
  return (result.meta.changes ?? 0) === 1;
}

export async function cleanupExpiredApprovals(db: D1Client): Promise<number> {
  const result = await db.run(`DELETE FROM order_approvals WHERE expires_at < ? AND used_at IS NULL`, [nowISO()]);
  return result.meta.changes ?? 0;
}
