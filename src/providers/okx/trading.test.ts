import { describe, expect, it, vi } from "vitest";
import type { OkxClient } from "./client";
import { OkxTradingProvider } from "./trading";

const BTC_INSTRUMENT = {
  instId: "BTC-USDT",
  instType: "SPOT",
  state: "live",
  lotSz: "0.00000001",
  minSz: "0.00001",
  tickSz: "0.1",
  maxMktSz: "10",
  maxMktAmt: "1000000",
  baseCcy: "BTC",
  quoteCcy: "USDT",
};

const BALANCE = {
  totalEq: "15000",
  uTime: "1700000000000",
  details: [
    { ccy: "USDT", eq: "5000", availBal: "4000", eqUsd: "5000" },
    { ccy: "BTC", eq: "0.2", availBal: "0.15", eqUsd: "10000" },
  ],
};

function createMockClient(routes: Record<string, unknown>) {
  const privateRequest = vi.fn(
    async (_method: string, path: string, _params?: unknown, _body?: unknown): Promise<unknown> => routes[path] ?? []
  );
  const publicRequest = vi.fn(async (_method: string, path: string) => routes[path] ?? []);
  return {
    client: { privateRequest, publicRequest } as unknown as OkxClient,
    privateRequest,
  };
}

describe("OkxTradingProvider", () => {
  it("reports spendable USDT as cash, not total equity", async () => {
    const { client } = createMockClient({ "/api/v5/account/balance": [BALANCE] });
    const account = await new OkxTradingProvider(client).getAccount();

    expect(account.equity).toBe(15000);
    expect(account.cash).toBe(4000);
    expect(account.buying_power).toBe(4000);
    expect(account.long_market_value).toBe(10000);
  });

  it("closes positions with tdMode=cash using the available (unfrozen) balance", async () => {
    const { client, privateRequest } = createMockClient({
      "/api/v5/account/balance": [BALANCE],
      "/api/v5/public/instruments": [BTC_INSTRUMENT],
      "/api/v5/trade/order": [{ ordId: "1", sCode: "0" }],
    });
    await new OkxTradingProvider(client).closePosition("BTC/USD");

    const orderCall = privateRequest.mock.calls.find((call) => call[1] === "/api/v5/trade/order")!;
    expect(orderCall[3]).toMatchObject({
      instId: "BTC-USDT",
      tdMode: "cash",
      side: "sell",
      ordType: "market",
      sz: "0.15000000",
    });
  });

  it("places notional market buys sized in quote currency", async () => {
    const { client, privateRequest } = createMockClient({
      "/api/v5/public/instruments": [BTC_INSTRUMENT],
      "/api/v5/trade/order": [{ ordId: "1", sCode: "0" }],
    });
    await new OkxTradingProvider(client).createOrder({
      symbol: "BTC/USD",
      notional: 123.456,
      side: "buy",
      type: "market",
      time_in_force: "gtc",
    });

    const orderCall = privateRequest.mock.calls.find((call) => call[1] === "/api/v5/trade/order")!;
    expect(orderCall[3]).toMatchObject({ tdMode: "cash", tgtCcy: "quote_ccy", sz: "123.45" });
  });

  it("rejects market orders above maxMktSz", async () => {
    const { client } = createMockClient({ "/api/v5/public/instruments": [BTC_INSTRUMENT] });
    await expect(
      new OkxTradingProvider(client).createOrder({
        symbol: "BTC/USD",
        qty: 11,
        side: "sell",
        type: "market",
        time_in_force: "gtc",
      })
    ).rejects.toThrow(/exceeds OKX maximum/);
  });

  it("routes stop orders to the algo trigger endpoint", async () => {
    const { client, privateRequest } = createMockClient({
      "/api/v5/public/instruments": [BTC_INSTRUMENT],
      "/api/v5/trade/order-algo": [{ algoId: "algo-1", sCode: "0" }],
    });
    const order = await new OkxTradingProvider(client).createOrder({
      symbol: "BTC/USD",
      qty: 0.1,
      side: "sell",
      type: "stop",
      stop_price: 40000,
      time_in_force: "gtc",
    });

    const algoCall = privateRequest.mock.calls.find((call) => call[1] === "/api/v5/trade/order-algo")!;
    expect(algoCall[3]).toMatchObject({ ordType: "trigger", triggerPx: "40000.0", orderPx: "-1", tdMode: "cash" });
    expect(order.id).toBe("algo-1");
  });

  it("cancels all pending orders in batches of 20 plus pending trigger orders", async () => {
    const pending = Array.from({ length: 25 }, (_, i) => ({ instId: "BTC-USDT", ordId: String(i) }));
    const { client, privateRequest } = createMockClient({
      "/api/v5/trade/orders-pending": pending,
      "/api/v5/trade/orders-algo-pending": [{ instId: "BTC-USDT", algoId: "a1" }],
    });
    await new OkxTradingProvider(client).cancelAllOrders();

    const batches = privateRequest.mock.calls.filter((call) => call[1] === "/api/v5/trade/cancel-batch-orders");
    expect(batches.map((call) => (call[3] as unknown as unknown[]).length)).toEqual([20, 5]);
    const algoCancel = privateRequest.mock.calls.find((call) => call[1] === "/api/v5/trade/cancel-algos")!;
    expect(algoCancel[3]).toEqual([{ instId: "BTC-USDT", algoId: "a1" }]);
  });

  it("resolves instId before cancelling an unknown order", async () => {
    const { client, privateRequest } = createMockClient({
      "/api/v5/trade/orders-pending": [{ instId: "ETH-USDT", ordId: "42", state: "live" }],
    });
    await new OkxTradingProvider(client).cancelOrder("42");

    const cancel = privateRequest.mock.calls.find((call) => call[1] === "/api/v5/trade/cancel-order")!;
    expect(cancel[3]).toEqual({ instId: "ETH-USDT", ordId: "42" });
  });
});

describe("OkxTradingProvider with a USDC quote (EEA/US accounts without USDT)", () => {
  const usdcBalance = {
    totalEq: "100000",
    uTime: "1700000000000",
    details: [
      { ccy: "USDC", eq: "5000", availBal: "5000", eqUsd: "4999" },
      { ccy: "USD", eq: "5000", availBal: "5000", eqUsd: "5000" },
      { ccy: "BTC", eq: "1", availBal: "1", eqUsd: "84000" },
    ],
  };

  it("counts USDC as spendable cash and trades BTC-USDC for BTC/USD", async () => {
    const { client, privateRequest } = createMockClient({
      "/api/v5/account/balance": [usdcBalance],
      "/api/v5/public/instruments": [{ ...BTC_INSTRUMENT, instId: "BTC-USDC", quoteCcy: "USDC" }],
      "/api/v5/trade/order": [{ ordId: "1", sCode: "0" }],
    });
    const provider = new OkxTradingProvider(client, "USDC");

    const account = await provider.getAccount();
    expect(account.cash).toBe(5000);
    expect(account.currency).toBe("USDC");

    const order = await provider.createOrder({
      symbol: "BTC/USD",
      notional: 100,
      side: "buy",
      type: "market",
      time_in_force: "gtc",
    });
    const orderCall = privateRequest.mock.calls.find((call) => call[1] === "/api/v5/trade/order")!;
    expect(orderCall[3]).toMatchObject({ instId: "BTC-USDC", tgtCcy: "quote_ccy" });
    expect(order.symbol).toBe("BTC/USD");
  });
});
