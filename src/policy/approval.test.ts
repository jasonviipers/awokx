import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderPreview } from "../mcp/types";
import type { D1Client, OrderApprovalRow } from "../storage/d1/client";
import { generateApprovalToken, validateApprovalToken } from "./approval";

describe("signed approval integrity", () => {
  afterEach(() => vi.useRealTimers());

  async function fixture() {
    const rows: OrderApprovalRow[] = [];
    const db = {
      run: vi.fn(async (_query: string, values: unknown[]) => {
        rows.push({
          id: values[0],
          preview_hash: values[1],
          order_params_json: values[2],
          policy_result_json: values[3],
          approval_token: values[4],
          expires_at: values[5],
          used_at: null,
        } as OrderApprovalRow);
        return { meta: { changes: 1 } };
      }),
      executeOne: vi.fn(async () => rows[0]),
    } as unknown as D1Client;
    const preview: OrderPreview = {
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      qty: 1,
      estimated_price: 150,
      notional: 150,
      asset_class: "us_equity",
      time_in_force: "day",
    };
    const secret = "test-signing-secret";
    const generated = await generateApprovalToken({
      scope: "orders",
      broker: "alpaca",
      db,
      secret,
      preview,
      policyResult: { allowed: true, violations: [], warnings: [] },
      ttlSeconds: 60,
    });
    return { db, secret, generated, row: rows[0]! };
  }

  it("persists and returns the same approval ID", async () => {
    const { db, secret, generated, row } = await fixture();
    expect(row.id).toBe(generated.approval_id);
    expect(
      await validateApprovalToken({ scope: "orders", broker: "alpaca", db, secret, token: generated.token })
    ).toMatchObject({
      valid: true,
      approval_id: generated.approval_id,
    });
  });

  it("rejects an order modified after approval", async () => {
    const { db, secret, generated, row } = await fixture();
    row.order_params_json = JSON.stringify({ ...JSON.parse(row.order_params_json), qty: 100 });
    expect(
      await validateApprovalToken({ scope: "orders", broker: "alpaca", db, secret, token: generated.token })
    ).toMatchObject({
      valid: false,
      reason: "Approved order has been modified",
    });
  });

  it("rejects approval reuse through another endpoint or broker", async () => {
    const { db, secret, generated } = await fixture();
    expect(
      await validateApprovalToken({ scope: "options", broker: "alpaca", db, secret, token: generated.token })
    ).toMatchObject({ valid: false });
    expect(
      await validateApprovalToken({ scope: "orders", broker: "okx", db, secret, token: generated.token })
    ).toMatchObject({ valid: false });
  });

  it("rejects at the exact expiry boundary", async () => {
    vi.useFakeTimers();
    const { db, secret, generated } = await fixture();
    vi.setSystemTime(new Date(generated.expires_at));
    expect(
      await validateApprovalToken({ scope: "orders", broker: "alpaca", db, secret, token: generated.token })
    ).toMatchObject({
      valid: false,
      reason: "Approval token expired",
    });
  });
});
