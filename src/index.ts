import { getHarnessStub } from "./durable-objects/mahoraga-harness";
import { consumeRateLimit } from "./durable-objects/session";
import type { Env } from "./env.d";
import { handleCronEvent } from "./jobs/cron";
import { constantTimeCompare, parseBoolean } from "./lib/utils";
import { MahoragaMcpAgent } from "./mcp/agent";

export { MahoragaHarness } from "./durable-objects/mahoraga-harness";
export { SessionDO } from "./durable-objects/session";
export { MahoragaMcpAgent };

function isAuthorized(request: Request, env: Env): boolean {
  const token = env.MAHORAGA_API_TOKEN;
  if (!token) return false;
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  return constantTimeCompare(authHeader.slice(7), token);
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized. Requires: Authorization: Bearer <MAHORAGA_API_TOKEN>" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

// Public data carries no credentials, so any origin may embed it (e.g. your own website).
const PUBLIC_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function publicJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...PUBLIC_CORS_HEADERS },
  });
}

async function handlePublicRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (!parseBoolean(env.PUBLIC_DASHBOARD, false)) {
    return publicJson({ ok: false, error: "Public dashboard is disabled" }, 404);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return publicJson({ ok: false, error: "Method not allowed" }, 405);
  }

  if (env.PUBLIC_RATE_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: `public:${ip}` });
    if (!success) {
      return publicJson({ ok: false, error: "Rate limit exceeded" }, 429);
    }
  }

  // Fresh request: never forward client headers (Authorization etc.) or a body to the harness.
  const harnessUrl = new URL(url.pathname.replace("/agent", ""), "http://harness");
  harnessUrl.search = url.search;
  const upstream = await getHarnessStub(env).fetch(new Request(harnessUrl.toString(), { method: "GET" }));

  const response = new Response(upstream.body, upstream);
  for (const [key, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      url.pathname = "/agent" + url.pathname.slice(4);
    }

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname === "/") {
      if (request.headers.get("accept")?.includes("text/html")) {
        return env.ASSETS?.fetch(request) ?? new Response("Not found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          name: "mahoraga",
          version: "0.3.0",
          description: "Autonomous LLM-powered trading agent on Cloudflare Workers",
          endpoints: {
            ui: "/",
            health: "/health",
            mcp: "/mcp (auth required)",
            agent: "/agent/* (auth required)",
            public: "/api/public/{status,history,trades} (read-only, if PUBLIC_DASHBOARD=true)",
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname.startsWith("/mcp")) {
      if (!isAuthorized(request, env)) {
        return unauthorizedResponse();
      }
      const rateCheck = await consumeRateLimit(env, "admin-api");
      if (!rateCheck.allowed) return Response.json({ error: "Rate limit exceeded", resetAt: rateCheck.resetAt }, { status: 429 });
      return MahoragaMcpAgent.mount("/mcp", { binding: "MCP_AGENT" }).fetch(request, env, ctx);
    }

    // Read-only spectator API (/api/public/*). Opt-in, unauthenticated, GET-only.
    if (url.pathname.startsWith("/agent/public/")) {
      return handlePublicRequest(request, env, url);
    }

    if (url.pathname === "/agent" || url.pathname.startsWith("/agent/")) {
      // /agent/kill is authorized by KILL_SWITCH_SECRET inside the harness, so it
      // must not also require MAHORAGA_API_TOKEN (the two secrets are distinct).
      const isKill = url.pathname === "/agent/kill";
      if (!isKill && !isAuthorized(request, env)) {
        return unauthorizedResponse();
      }

      // Fixed key: never persist token fragments or create attacker-chosen objects.
      // Emergency stop remains available even when the normal API quota is exhausted.
      if (!isKill) {
        const rateCheck = await consumeRateLimit(env, "admin-api");
        if (!rateCheck.allowed) {
          return Response.json({ error: "Rate limit exceeded", resetAt: rateCheck.resetAt }, { status: 429 });
        }
      }

      const stub = getHarnessStub(env);
      const agentPath = url.pathname.replace("/agent", "") || "/status";
      const agentUrl = new URL(agentPath, "http://harness");
      agentUrl.search = url.search;
      return stub.fetch(
        new Request(agentUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })
      );
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cronId = event.cron;
    console.log(`Cron triggered: ${cronId} at ${new Date().toISOString()}`);
    ctx.waitUntil(handleCronEvent(cronId, env));
  },
};
