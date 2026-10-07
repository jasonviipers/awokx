import { createError, ErrorCode } from "../../lib/errors";
import type {
  Account,
  Asset,
  BrokerProvider,
  ListOrdersParams,
  MarketClock,
  MarketDay,
  Order,
  OrderParams,
  OrderStatus,
  PortfolioHistory,
  PortfolioHistoryParams,
  Position,
} from "../types";
import type { OkxClient } from "./client";
import {
  formatPrice,
  formatQty,
  fromInstId,
  isCashCurrency,
  msToIso,
  OKX_QUOTE_CCY,
  type OkxBalance,
  type OkxBalanceDetail,
  type OkxInstrument,
  type OkxOrder,
  type OkxTicker,
  toInstId,
} from "./instruments";

interface OkxOrderAck {
  instId?: string;
  ordId: string;
  clOrdId?: string;
  tag?: string;
  sCode?: string;
  sMsg?: string;
}

interface OrderAckContext {
  instId: string;
  side: string;
  ordType: string;
  sz: string;
  clientOrderId?: string;
  limitPrice?: string;
  stopPrice?: string;
}

const INSTRUMENT_CACHE_TTL_MS = 5 * 60_000;
const CANCEL_BATCH_SIZE = 20;
const CANCEL_ALGO_BATCH_SIZE = 10;
const MAX_PENDING_PAGES = 10;

function sanitizeClientOrderId(clientOrderId: string): string {
  return clientOrderId.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}

/** Enforce instrument limits (minSz, and maxMktSz for market orders) before hitting OKX. */
function assertBaseSize(instrument: OkxInstrument, size: number, isMarket: boolean): void {
  const minSz = parseFloat(instrument.minSz) || 0;
  if (!(size > 0) || size < minSz) {
    throw createError(ErrorCode.INVALID_INPUT, `Order size ${size} is below minimum ${minSz} for ${instrument.instId}`);
  }
  const maxMktSz = parseFloat(instrument.maxMktSz ?? "") || 0;
  if (isMarket && maxMktSz > 0 && size > maxMktSz) {
    throw createError(
      ErrorCode.INVALID_INPUT,
      `Market order size ${size} exceeds OKX maximum ${maxMktSz} for ${instrument.instId}`
    );
  }
}

function mapOrderStatus(state: string): OrderStatus {
  switch (state) {
    case "partially_filled":
      return "partially_filled";
    case "filled":
      return "filled";
    case "canceled":
    case "mmp_canceled":
      return "canceled";
    default:
      return "new";
  }
}

function parseOkxOrder(raw: OkxOrder): Order {
  const state = raw.state || raw.ordStatus || "live";
  const filledAt = state === "filled" && raw.fillTime ? msToIso(raw.fillTime) : null;
  return {
    id: raw.ordId,
    client_order_id: raw.clOrdId || "",
    symbol: fromInstId(raw.instId),
    asset_id: raw.instId,
    asset_class: "crypto",
    qty: raw.sz || "0",
    filled_qty: raw.accFillSz || "0",
    filled_avg_price: raw.avgPx || null,
    order_class: "simple",
    order_type: raw.ordType,
    type: raw.ordType,
    side: raw.side === "sell" ? "sell" : "buy",
    time_in_force: "",
    limit_price: raw.px || null,
    stop_price: raw.slTriggerPx || raw.tpTriggerPx || null,
    status: mapOrderStatus(state),
    extended_hours: false,
    created_at: msToIso(raw.cTime),
    updated_at: msToIso(raw.uTime),
    submitted_at: msToIso(raw.cTime),
    filled_at: filledAt,
    expired_at: null,
    canceled_at: state === "canceled" || state === "mmp_canceled" ? msToIso(raw.uTime) : null,
    failed_at: raw.sCode && raw.sCode !== "0" ? msToIso(raw.uTime) : null,
  };
}

function parseOrderAck(ack: OkxOrderAck, ctx: OrderAckContext): Order {
  const now = new Date().toISOString();
  const rejected = ack.sCode && ack.sCode !== "0";
  return {
    id: ack.ordId,
    client_order_id: ack.clOrdId || ctx.clientOrderId || "",
    symbol: fromInstId(ctx.instId),
    asset_id: ctx.instId,
    asset_class: "crypto",
    qty: ctx.sz,
    filled_qty: "0",
    filled_avg_price: null,
    order_class: "simple",
    order_type: ctx.ordType,
    type: ctx.ordType,
    side: ctx.side === "sell" ? "sell" : "buy",
    time_in_force: "",
    limit_price: ctx.limitPrice ?? null,
    stop_price: ctx.stopPrice ?? null,
    status: rejected ? "rejected" : "new",
    extended_hours: false,
    created_at: now,
    updated_at: now,
    submitted_at: now,
    filled_at: null,
    expired_at: null,
    canceled_at: null,
    failed_at: rejected ? now : null,
  };
}

export class OkxTradingProvider implements BrokerProvider {
  private instrumentCache = new Map<string, { data: OkxInstrument; fetchedAt: number }>();
  private instIdByOrderId = new Map<string, string>();

  constructor(private client: OkxClient) {}

  async getBalances(): Promise<OkxBalanceDetail[]> {
    const balance = await this.getBalance();
    return balance.details ?? [];
  }

  async getAccount(): Promise<Account> {
    const balance = await this.getBalance();
    const totalEq = parseFloat(balance.totalEq) || 0;
    // Orders are placed on <BASE>-USDT pairs, so only available USDT is spendable.
    // totalEq includes crypto holdings and must not be used for position sizing.
    const quote = (balance.details ?? []).find((detail) => detail.ccy === OKX_QUOTE_CCY);
    const cash = quote ? parseFloat(quote.availBal) || 0 : 0;
    const cashEqUsd = (balance.details ?? [])
      .filter((detail) => isCashCurrency(detail.ccy))
      .reduce((sum, detail) => sum + (parseFloat(detail.eqUsd) || 0), 0);
    return {
      id: "okx-spot",
      account_number: "",
      status: "ACTIVE",
      currency: OKX_QUOTE_CCY,
      cash,
      buying_power: cash,
      regt_buying_power: 0,
      daytrading_buying_power: 0,
      equity: totalEq,
      last_equity: totalEq,
      long_market_value: Math.max(0, totalEq - cashEqUsd),
      short_market_value: 0,
      portfolio_value: totalEq,
      pattern_day_trader: false,
      trading_blocked: false,
      transfers_blocked: false,
      account_blocked: false,
      multiplier: "1",
      shorting_enabled: false,
      maintenance_margin: 0,
      initial_margin: 0,
      daytrade_count: 0,
      created_at: msToIso(balance.uTime),
    };
  }

  async getPositions(): Promise<Position[]> {
    const [balance, tickers] = await Promise.all([this.getBalance(), this.getSpotTickers()]);
    const positions: Position[] = [];
    const seen = new Set<string>();

    for (const detail of balance.details ?? []) {
      const ccy = detail.ccy;
      if (isCashCurrency(ccy)) continue;

      const eq = parseFloat(detail.eq) || 0;
      if (eq <= 0) continue;

      const instId = `${ccy}-${OKX_QUOTE_CCY}`;
      if (seen.has(instId)) continue;
      seen.add(instId);

      const instrument = await this.getInstrument(instId);
      if (!instrument || instrument.state !== "live") continue;

      const ticker = tickers.get(instId);
      const price = ticker ? parseFloat(ticker.last) || 0 : 0;
      const open24h = ticker ? parseFloat(ticker.open24h) || 0 : 0;
      const marketValue = price > 0 ? eq * price : 0;

      positions.push({
        asset_id: instId,
        symbol: fromInstId(instId),
        exchange: "OKX",
        asset_class: "crypto",
        avg_entry_price: 0,
        qty: eq,
        side: "long",
        market_value: marketValue,
        cost_basis: 0,
        unrealized_pl: 0,
        unrealized_plpc: 0,
        unrealized_intraday_pl: 0,
        unrealized_intraday_plpc: 0,
        current_price: price,
        lastday_price: 0,
        change_today: open24h > 0 ? ((price - open24h) / open24h) * 100 : 0,
      });
    }

    return positions;
  }

  async getPosition(symbol: string): Promise<Position | null> {
    const target = toInstId(symbol);
    const positions = await this.getPositions();
    return positions.find((position) => toInstId(position.symbol) === target) ?? null;
  }

  async closePosition(symbol: string, qty?: number, percentage?: number): Promise<Order> {
    const instId = toInstId(symbol);
    const [base] = instId.split("-");

    // availBal excludes funds frozen in open orders, which OKX would reject as insufficient.
    const balance = await this.getBalance();
    const detail = (balance.details ?? []).find((entry) => entry.ccy === base);
    const held = detail ? parseFloat(detail.availBal) || 0 : 0;

    let size = held;
    if (qty !== undefined) {
      size = qty;
    } else if (percentage !== undefined) {
      size = held * (percentage / 100);
    }

    if (!Number.isFinite(size) || size <= 0) {
      throw createError(ErrorCode.NOT_FOUND, `No position to close for ${symbol}`);
    }

    const instrument = await this.getInstrument(instId);
    if (!instrument) {
      throw createError(ErrorCode.NOT_FOUND, `Instrument not found: ${instId}`);
    }

    const lotSz = parseFloat(instrument.lotSz) || 1e-8;
    const sz = formatQty(size, lotSz);
    assertBaseSize(instrument, parseFloat(sz), true);

    const ack = await this.placeOrder({
      instId,
      tdMode: "cash",
      side: "sell",
      ordType: "market",
      sz,
    });

    return parseOrderAck(ack, { instId, side: "sell", ordType: "market", sz });
  }

  async createOrder(params: OrderParams): Promise<Order> {
    const instId = toInstId(params.symbol);
    const instrument = await this.getInstrument(instId);
    if (!instrument) {
      throw createError(ErrorCode.NOT_FOUND, `Instrument not found: ${instId}`);
    }

    const lotSz = parseFloat(instrument.lotSz) || 1e-8;
    const tickSz = parseFloat(instrument.tickSz) || 1e-8;
    const side = params.side;

    if (params.type === "stop" || params.type === "stop_limit") {
      return this.createTriggerOrder(params, instId, lotSz, tickSz);
    }

    let ordType: string;
    if (params.type === "market") {
      ordType = "market";
    } else if (params.type === "limit") {
      ordType = params.time_in_force === "ioc" ? "ioc" : params.time_in_force === "fok" ? "fok" : "limit";
    } else {
      throw createError(ErrorCode.NOT_SUPPORTED, `OKX spot does not support order type '${params.type}'`);
    }

    const body: Record<string, unknown> = {
      instId,
      tdMode: "cash",
      side,
      ordType,
    };

    const isMarket = params.type === "market";
    if (isMarket && side === "buy" && params.qty === undefined && params.notional !== undefined) {
      body.tgtCcy = "quote_ccy";
      body.sz = formatQty(params.notional, 0.01);
      const amount = parseFloat(body.sz as string);
      const maxMktAmt = parseFloat(instrument.maxMktAmt ?? "") || 0;
      if (!(amount > 0)) {
        throw createError(ErrorCode.INVALID_INPUT, `Order notional required for ${instId}`);
      }
      if (maxMktAmt > 0 && amount > maxMktAmt) {
        throw createError(
          ErrorCode.INVALID_INPUT,
          `Market order notional ${amount} exceeds OKX maximum ${maxMktAmt} for ${instId}`
        );
      }
    } else {
      const qty = params.qty ?? 0;
      if (!Number.isFinite(qty) || qty <= 0) {
        throw createError(ErrorCode.INVALID_INPUT, `Order size required for ${instId}`);
      }
      // Spot market buys default to quote_ccy sizing; qty is always base quantity.
      if (isMarket && side === "buy") {
        body.tgtCcy = "base_ccy";
      }
      body.sz = formatQty(qty, lotSz);
      assertBaseSize(instrument, parseFloat(body.sz as string), isMarket);
    }

    let limitPrice: string | undefined;

    if (params.type === "limit") {
      if (params.limit_price === undefined) {
        throw createError(ErrorCode.INVALID_INPUT, `Limit price required for ${instId}`);
      }
      limitPrice = formatPrice(params.limit_price, tickSz);
      body.px = limitPrice;
    }

    if (params.client_order_id) {
      const clientOrderId = sanitizeClientOrderId(params.client_order_id);
      if (clientOrderId) {
        body.clOrdId = clientOrderId;
      }
    }

    const ack = await this.placeOrder(body);
    return parseOrderAck(ack, {
      instId,
      side,
      ordType,
      sz: body.sz as string,
      clientOrderId: body.clOrdId as string | undefined,
      limitPrice,
    });
  }

  /**
   * Stop / stop-limit orders are algo "trigger" orders on OKX (POST /api/v5/trade/order-algo).
   * orderPx "-1" executes at market once triggerPx is hit. The returned id is the algoId.
   */
  private async createTriggerOrder(params: OrderParams, instId: string, lotSz: number, tickSz: number): Promise<Order> {
    if (params.stop_price === undefined) {
      throw createError(ErrorCode.INVALID_INPUT, `Stop price required for ${params.type} order on ${instId}`);
    }
    const qty = params.qty ?? 0;
    if (!Number.isFinite(qty) || qty <= 0) {
      throw createError(ErrorCode.INVALID_INPUT, `Order size required for ${instId}`);
    }

    const stopPrice = formatPrice(params.stop_price, tickSz);
    let limitPrice: string | undefined;
    if (params.type === "stop_limit") {
      if (params.limit_price === undefined) {
        throw createError(ErrorCode.INVALID_INPUT, `Limit price required for stop_limit order on ${instId}`);
      }
      limitPrice = formatPrice(params.limit_price, tickSz);
    }

    const sz = formatQty(qty, lotSz);
    const body: Record<string, unknown> = {
      instId,
      tdMode: "cash",
      side: params.side,
      ordType: "trigger",
      sz,
      // Spot market buys default to quote_ccy sizing; sz here is always base quantity.
      tgtCcy: "base_ccy",
      triggerPx: stopPrice,
      orderPx: limitPrice ?? "-1",
    };
    if (params.client_order_id) {
      const clientOrderId = sanitizeClientOrderId(params.client_order_id);
      if (clientOrderId) {
        body.algoClOrdId = clientOrderId;
      }
    }

    const [ack] = await this.client.privateRequest<Array<{ algoId: string; algoClOrdId?: string; sCode?: string }>>(
      "POST",
      "/api/v5/trade/order-algo",
      undefined,
      body
    );
    if (!ack?.algoId) {
      throw createError(ErrorCode.PROVIDER_ERROR, "OKX returned no algo order acknowledgement");
    }

    return parseOrderAck(
      { ordId: ack.algoId, clOrdId: ack.algoClOrdId, sCode: ack.sCode },
      {
        instId,
        side: params.side,
        ordType: params.type,
        sz,
        clientOrderId: body.algoClOrdId as string | undefined,
        limitPrice,
        stopPrice,
      }
    );
  }

  async getOrder(orderId: string): Promise<Order> {
    const knownInstId = this.instIdByOrderId.get(orderId);

    if (knownInstId) {
      const byId = await this.client.privateRequest<OkxOrder[]>("GET", "/api/v5/trade/order", {
        instId: knownInstId,
        ordId: orderId,
      });
      const hit = byId?.find((order) => order.ordId === orderId);
      if (hit) {
        this.registerOrder(hit);
        return parseOkxOrder(hit);
      }
    }

    // GET /trade/order requires instId. Without it, scan the most recent pending and
    // historical orders (these list endpoints have no ordId filter; max 100 per page).
    const pending = await this.client.privateRequest<OkxOrder[]>("GET", "/api/v5/trade/orders-pending", {
      instType: "SPOT",
      limit: 100,
    });
    const pendingHit = pending?.find((order) => order.ordId === orderId);
    if (pendingHit) {
      this.registerOrder(pendingHit);
      return parseOkxOrder(pendingHit);
    }

    const history = await this.client.privateRequest<OkxOrder[]>("GET", "/api/v5/trade/orders-history", {
      instType: "SPOT",
      limit: 100,
    });
    const historyHit = history?.find((order) => order.ordId === orderId);
    if (historyHit) {
      this.registerOrder(historyHit);
      return parseOkxOrder(historyHit);
    }

    throw createError(ErrorCode.NOT_FOUND, `Order not found: ${orderId}`);
  }

  async listOrders(params?: ListOrdersParams): Promise<Order[]> {
    const status = params?.status ?? "all";
    const limit = Math.min(params?.limit ?? 100, 100);
    const rawOrders: OkxOrder[] = [];

    if (status === "open" || status === "all") {
      const pending = await this.client.privateRequest<OkxOrder[]>("GET", "/api/v5/trade/orders-pending", {
        instType: "SPOT",
        limit,
      });
      rawOrders.push(...(pending ?? []));
    }

    if (status === "closed" || status === "all") {
      const history = await this.client.privateRequest<OkxOrder[]>("GET", "/api/v5/trade/orders-history", {
        instType: "SPOT",
        limit,
      });
      rawOrders.push(...(history ?? []));
    }

    let filtered = rawOrders;
    if (params?.symbols?.length) {
      const symbolSet = new Set(params.symbols.map(toInstId));
      filtered = filtered.filter((order) => symbolSet.has(order.instId));
    }

    const seen = new Set<string>();
    const orders: Order[] = [];
    for (const order of filtered) {
      if (seen.has(order.ordId)) continue;
      seen.add(order.ordId);
      this.registerOrder(order);
      orders.push(parseOkxOrder(order));
      if (orders.length >= limit) break;
    }
    return orders;
  }

  async cancelOrder(orderId: string): Promise<void> {
    // cancel-order requires instId; resolve it if this order wasn't seen by this instance.
    let instId = this.instIdByOrderId.get(orderId);
    if (!instId) {
      instId = (await this.getOrder(orderId)).asset_id;
    }
    await this.client.privateRequest<unknown[]>("POST", "/api/v5/trade/cancel-order", undefined, {
      instId,
      ordId: orderId,
    });
  }

  /**
   * OKX has no cancel-all endpoint for spot. Page through pending SPOT orders and
   * cancel them via cancel-batch-orders (max 20 per request).
   */
  async cancelAllOrders(): Promise<void> {
    const pending: OkxOrder[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PENDING_PAGES; page++) {
      const batch = await this.client.privateRequest<OkxOrder[]>("GET", "/api/v5/trade/orders-pending", {
        instType: "SPOT",
        limit: 100,
        after,
      });
      if (!batch?.length) break;
      pending.push(...batch);
      if (batch.length < 100) break;
      after = batch[batch.length - 1]!.ordId;
    }

    // Keep going on partial failures (e.g. an order filled mid-cancel) so one bad batch
    // can't leave the rest live; report the first failure at the end.
    let firstError: unknown = null;
    for (let i = 0; i < pending.length; i += CANCEL_BATCH_SIZE) {
      const chunk = pending.slice(i, i + CANCEL_BATCH_SIZE).map((order) => ({
        instId: order.instId,
        ordId: order.ordId,
      }));
      try {
        await this.client.privateRequest<unknown[]>("POST", "/api/v5/trade/cancel-batch-orders", undefined, chunk);
      } catch (error) {
        firstError ??= error;
      }
    }

    // Stop / stop-limit orders live in the algo book and need a separate cancel.
    try {
      const algos = await this.client.privateRequest<Array<{ instId: string; algoId: string }>>(
        "GET",
        "/api/v5/trade/orders-algo-pending",
        { instType: "SPOT", ordType: "trigger", limit: 100 }
      );
      for (let i = 0; i < (algos ?? []).length; i += CANCEL_ALGO_BATCH_SIZE) {
        const chunk = algos.slice(i, i + CANCEL_ALGO_BATCH_SIZE).map((algo) => ({
          instId: algo.instId,
          algoId: algo.algoId,
        }));
        await this.client.privateRequest<unknown[]>("POST", "/api/v5/trade/cancel-algos", undefined, chunk);
      }
    } catch (error) {
      firstError ??= error;
    }

    if (firstError) throw firstError;
  }

  async getClock(): Promise<MarketClock> {
    const now = new Date();
    const timestamp = now.toISOString();
    const nextClose = new Date(now.getTime() + 86_400_000).toISOString();
    return {
      timestamp,
      is_open: true,
      next_open: timestamp,
      next_close: nextClose,
    };
  }

  async getCalendar(start: string, end: string): Promise<MarketDay[]> {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    const days: MarketDay[] = [];
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return days;
    }
    for (let at = startMs; at <= endMs; at += 86_400_000) {
      const date = new Date(at).toISOString().slice(0, 10);
      days.push({ date, open: "00:00", close: "23:59", settlement_date: date });
    }
    return days;
  }

  async getAsset(symbol: string): Promise<Asset | null> {
    const instId = toInstId(symbol);
    const instrument = await this.getInstrument(instId);
    if (!instrument) {
      return null;
    }
    const active = instrument.state === "live";
    return {
      id: instrument.instId,
      class: "crypto",
      exchange: "OKX",
      symbol: fromInstId(instrument.instId),
      name: instrument.instId,
      status: active ? "active" : "inactive",
      tradable: active,
      marginable: false,
      shortable: false,
      fractionable: true,
    };
  }

  async getPortfolioHistory(params?: PortfolioHistoryParams): Promise<PortfolioHistory> {
    const balance = await this.getBalance();
    const equity = parseFloat(balance.totalEq) || 0;
    const timestamp = balance.uTime ? Math.floor(parseInt(balance.uTime, 10) / 1000) : Math.floor(Date.now() / 1000);
    return {
      timestamp: [timestamp],
      equity: [equity],
      profit_loss: [0],
      profit_loss_pct: [0],
      base_value: equity,
      timeframe: params?.timeframe ?? "1D",
    };
  }

  private async placeOrder(body: Record<string, unknown>): Promise<OkxOrderAck> {
    const [ack] = await this.client.privateRequest<OkxOrderAck[]>("POST", "/api/v5/trade/order", undefined, body);
    if (!ack) {
      throw createError(ErrorCode.PROVIDER_ERROR, "OKX returned no order acknowledgement");
    }
    if (ack.ordId) {
      this.instIdByOrderId.set(ack.ordId, body.instId as string);
    }
    return ack;
  }

  private registerOrder(order: OkxOrder): void {
    if (order.ordId) {
      this.instIdByOrderId.set(order.ordId, order.instId);
    }
  }

  private async getInstrument(instId: string): Promise<OkxInstrument | null> {
    const cacheHit = this.instrumentCache.get(instId);
    if (cacheHit && Date.now() - cacheHit.fetchedAt < INSTRUMENT_CACHE_TTL_MS) {
      return cacheHit.data;
    }
    const data = await this.client.publicRequest<OkxInstrument[]>("GET", "/api/v5/public/instruments", {
      instType: "SPOT",
      instId,
    });
    const instrument = data?.[0];
    if (instrument) {
      this.instrumentCache.set(instId, { data: instrument, fetchedAt: Date.now() });
    }
    return instrument ?? null;
  }

  private async getBalance(): Promise<OkxBalance> {
    const [balance] = await this.client.privateRequest<OkxBalance[]>("GET", "/api/v5/account/balance");
    return (
      balance ?? { totalEq: "0", adjEq: "0", mgnRatio: "", isoEq: "0", imr: "0", mmr: "0", uTime: "", details: [] }
    );
  }

  private async getSpotTickers(): Promise<Map<string, OkxTicker>> {
    const tickers = await this.client.publicRequest<OkxTicker[]>("GET", "/api/v5/market/tickers", {
      instType: "SPOT",
    });
    return new Map((tickers ?? []).map((ticker) => [ticker.instId, ticker]));
  }
}

export function createOkxTradingProvider(client: OkxClient): OkxTradingProvider {
  return new OkxTradingProvider(client);
}
