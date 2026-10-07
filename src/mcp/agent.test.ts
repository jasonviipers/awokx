import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { Env } from "../env.d";
import { createViipersMcpServer } from "./agent";

/** D1 stand-in: empty tables, so tools run their "no data" paths without a database. */
function fakeD1() {
  const statement = {
    bind: () => statement,
    first: async () => null,
    all: async () => ({ results: [], success: true, meta: {} }),
    run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
  };
  return { prepare: () => statement, batch: async () => [] };
}

function fakeEnv(): Env {
  return {
    DB: fakeD1(),
    CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
    ALPACA_API_KEY: "test-key",
    ALPACA_API_SECRET: "test-secret",
    ALPACA_PAPER: "true",
    FEATURE_LLM_RESEARCH: "false",
    FEATURE_OPTIONS: "false",
    KILL_SWITCH_SECRET: "test-kill-secret",
  } as unknown as Env;
}

/** Connects the official MCP v2 client to the stateless HTTP handler through an in-memory fetch. */
async function connect() {
  const env = fakeEnv();
  const handler = createMcpHandler(() => createViipersMcpServer(env));
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  const client = new Client({ name: "viipers-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

describe("Viipers MCP server (stateless, SDK v2)", () => {
  it("lists every registered tool with an input schema", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(tools.length).toBe(42);
    expect(new Set(names).size).toBe(names.length);
    for (const expected of [
      "auth-verify",
      "accounts-get",
      "orders-preview",
      "orders-submit",
      "kill-switch-enable",
      "web-scrape-financial",
      "catalog-list",
    ]) {
      expect(names).toContain(expected);
    }
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
    await client.close();
  });

  it("enforces the scraper domain allowlist without any network call", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "web-scrape-financial",
      arguments: { url: "http://169.254.169.254/latest/meta-data" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Domain not in allowlist");
    await client.close();
  });

  it("rejects calls that fail input validation", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "web-scrape-financial", arguments: { url: "not-a-url" } });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
