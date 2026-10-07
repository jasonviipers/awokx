import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.d";

interface RateLimitState {
  requestCount: number;
  lastRequestAt: string | null;
  rateLimitResetAt: string | null;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;

export class SessionDO extends DurableObject<Env> {
  private state: RateLimitState = { requestCount: 0, lastRequestAt: null, rateLimitResetAt: null };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<RateLimitState>("state");
      if (stored) this.state = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/consume-rate-limit" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    const now = Date.now();
    const resetAt = this.state.rateLimitResetAt ? Date.parse(this.state.rateLimitResetAt) : 0;
    if (!Number.isFinite(resetAt) || now >= resetAt) {
      this.state.requestCount = 0;
      this.state.rateLimitResetAt = new Date(now + RATE_LIMIT_WINDOW_MS).toISOString();
    }
    // Check and reserve synchronously before the first await: concurrent callers
    // cannot both observe the same remaining slot.
    const allowed = this.state.requestCount < RATE_LIMIT_MAX_REQUESTS;
    if (allowed) {
      this.state.requestCount++;
      this.state.lastRequestAt = new Date(now).toISOString();
      await this.ctx.storage.put("state", this.state);
    }
    return Response.json({
      allowed,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - this.state.requestCount),
      resetAt: this.state.rateLimitResetAt,
    });
  }
}

export async function consumeRateLimit(env: Env, sessionId: string): Promise<RateLimitResult> {
  const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
  const response = await stub.fetch(new Request("http://session/consume-rate-limit", { method: "POST" }));
  if (!response.ok) throw new Error("Rate limiter unavailable");
  return response.json() as Promise<RateLimitResult>;
}
