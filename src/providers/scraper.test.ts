import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedDomain, scrapeUrl } from "./scraper";

describe("scraper security", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "http://finance.yahoo.com/",
    "https://user:pass@finance.yahoo.com/",
    "https://finance.yahoo.com:8443/",
    "https://finance.yahoo.com.attacker.example/",
    "https://127.0.0.1/",
    "file:///etc/passwd",
  ])("rejects unsafe URL %s", (url) => expect(isAllowedDomain(url)).toBe(false));

  it("blocks an allowlisted URL redirecting to an internal host before fetching it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(scrapeUrl("https://finance.yahoo.com/redirect")).rejects.toThrow("destination is not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1].redirect).toBe("manual");
  });

  it("permits a validated relative redirect and reports the final URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "/quote/AAPL" } }))
      .mockResolvedValueOnce(
        new Response("<title>Apple</title><p>Revenue growth</p>", { headers: { "Content-Type": "text/html" } })
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await scrapeUrl("https://finance.yahoo.com/start");
    expect(result.url).toBe("https://finance.yahoo.com/quote/AAPL");
    expect(result.title).toBe("Apple");
  });

  it("limits response bytes while reading and cancels the oversized stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(500_001)));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/plain" } }))
    );
    const result = await scrapeUrl("https://finance.yahoo.com/large");
    expect(result.truncated).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.text.length).toBeLessThanOrEqual(50_000);
  });
});
