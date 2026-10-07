import { describe, expect, it, vi } from "vitest";
import type { D1Client } from "../client";
import { insertToolLog } from "./tool-logs";

describe("trade tool logging", () => {
  it("binds the resolved hash and redacts credentials in input/output/error", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    await insertToolLog({ run } as unknown as D1Client, {
      request_id: "request",
      tool_name: "orders-preview",
      input: { apiKey: "sensitive", symbol: "AAPL" },
      output: { approval_token: "sensitive" },
      error: { authorization: "sensitive" },
    });
    const values = run.mock.calls[0]![1];
    expect(values[3]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(values)).not.toContain("sensitive");
    expect(JSON.parse(values[4]).symbol).toBe("AAPL");
  });
});
