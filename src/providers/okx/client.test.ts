import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../../lib/errors";
import { mapBusinessCode, OkxClient, okxSign } from "./client";

const config = { apiKey: "key", apiSecret: "secret", apiPassphrase: "pass" };

function okResponse(data: unknown, code = "0", msg = ""): Response {
  return new Response(JSON.stringify({ code, msg, data }), { status: 200 });
}

describe("OkxClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs GET requests over path + query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OkxClient(config);
    await client.privateRequest("GET", "/api/v5/trade/order", { instId: "BTC-USDT", ordId: "123" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openapi.okx.com/api/v5/trade/order?instId=BTC-USDT&ordId=123");
    const headers = init.headers as Record<string, string>;
    const expected = await okxSign(
      headers["OK-ACCESS-TIMESTAMP"]!,
      "GET",
      "/api/v5/trade/order?instId=BTC-USDT&ordId=123",
      "",
      "secret"
    );
    expect(headers["OK-ACCESS-SIGN"]).toBe(expected);
  });

  it("signs POST requests over the JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OkxClient(config);
    const body = { instId: "BTC-USDT", ordId: "1" };
    await client.privateRequest("POST", "/api/v5/trade/cancel-order", undefined, body);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    const expected = await okxSign(
      headers["OK-ACCESS-TIMESTAMP"]!,
      "POST",
      "/api/v5/trade/cancel-order",
      JSON.stringify(body),
      "secret"
    );
    expect(headers["OK-ACCESS-SIGN"]).toBe(expected);
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("sends the demo trading header when simulated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await new OkxClient({ ...config, simulated: true }).publicRequest("GET", "/api/v5/market/ticker");
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["x-simulated-trading"]).toBe("1");
  });

  it("surfaces per-order sCode/sMsg when the operation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse([{ ordId: "", sCode: "51008", sMsg: "Insufficient balance" }], "1"))
    );

    await expect(
      new OkxClient(config).privateRequest("POST", "/api/v5/trade/order", undefined, {})
    ).rejects.toMatchObject({
      code: ErrorCode.INSUFFICIENT_BUYING_POWER,
      message: expect.stringContaining("Insufficient balance"),
    });
  });

  it("rejects non-https base URLs", () => {
    expect(() => new OkxClient({ ...config, baseUrl: "http://www.okx.com" })).toThrow(/https/);
  });

  it("refuses private calls without credentials", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      new OkxClient({ apiKey: "", apiSecret: "", apiPassphrase: "" }).privateRequest("GET", "/api/v5/account/balance")
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });

  it("maps OKX business codes", () => {
    expect(mapBusinessCode("50113")).toBe(ErrorCode.UNAUTHORIZED);
    expect(mapBusinessCode("50011")).toBe(ErrorCode.RATE_LIMITED);
    expect(mapBusinessCode("51603")).toBe(ErrorCode.NOT_FOUND);
    expect(mapBusinessCode("51000")).toBe(ErrorCode.INVALID_INPUT);
    expect(mapBusinessCode("50013")).toBe(ErrorCode.PROVIDER_ERROR);
  });
});
