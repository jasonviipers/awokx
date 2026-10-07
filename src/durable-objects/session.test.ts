import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.d";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: DurableObjectState,
      public env: Env
    ) {}
  },
}));

import { SessionDO } from "./session";

describe("atomic API quota", () => {
  afterEach(() => vi.useRealTimers());
  it("reserves only 100 slots under concurrent requests and resets at the boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = {
      blockConcurrencyWhile: vi.fn(),
      storage: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) },
    } as unknown as DurableObjectState;
    const limiter = new SessionDO(ctx, {} as Env);
    const request = () => new Request("http://session/consume-rate-limit", { method: "POST" });
    const results = await Promise.all(
      Array.from({ length: 150 }, async () => (await limiter.fetch(request())).json() as Promise<{ allowed: boolean }>)
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(100);
    vi.setSystemTime(60_000);
    expect(await (await limiter.fetch(request())).json()).toMatchObject({ allowed: true, remaining: 99 });
  });
});
