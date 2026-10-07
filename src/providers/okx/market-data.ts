import type { Bar, BarsParams, MarketDataProvider, Quote, Snapshot } from "../types";
import type { OkxClient } from "./client";
import {
  fromInstId,
  mapTimeframe,
  msToIso,
  type OkxCandle,
  type OkxCandleRaw,
  type OkxTicker,
  parseOkxCandle,
  toInstId,
} from "./instruments";

const EMPTY_CANDLE: OkxCandle = { ts: "", o: 0, h: 0, l: 0, c: 0, vol: 0, volCcy: 0, confirm: "" };

function toBar(candle: OkxCandle | null): Bar {
  if (!candle) {
    return { t: "", o: 0, h: 0, l: 0, c: 0, v: 0, n: 0, vw: 0 };
  }
  return {
    t: msToIso(candle.ts),
    o: candle.o,
    h: candle.h,
    l: candle.l,
    c: candle.c,
    v: candle.vol,
    n: 0,
    vw: candle.vol > 0 ? candle.volCcy / candle.vol : 0,
  };
}

function toQuote(ticker: OkxTicker): Quote {
  return {
    symbol: fromInstId(ticker.instId),
    bid_price: parseFloat(ticker.bidPx) || 0,
    bid_size: parseFloat(ticker.bidSz) || 0,
    ask_price: parseFloat(ticker.askPx) || 0,
    ask_size: parseFloat(ticker.askSz) || 0,
    timestamp: msToIso(ticker.ts),
  };
}

export class OkxMarketDataProvider implements MarketDataProvider {
  constructor(private client: OkxClient) {}

  async getBars(symbol: string, timeframe: string, params?: BarsParams): Promise<Bar[]> {
    const instId = toInstId(symbol);
    const bar = mapTimeframe(timeframe);

    const rawCandles = await this.client.publicRequest<OkxCandleRaw[]>("GET", "/api/v5/market/candles", {
      instId,
      bar,
      limit: Math.min(params?.limit ?? 100, 100),
    });

    const candles = (rawCandles ?? []).map(parseOkxCandle);

    const startTs = params?.start ? Date.parse(params.start) : Number.NaN;
    const endTs = params?.end ? Date.parse(params.end) : Number.NaN;

    const filtered = candles.filter((candle) => {
      const ts = parseInt(candle.ts, 10);
      if (!Number.isNaN(startTs) && ts < startTs) return false;
      if (!Number.isNaN(endTs) && ts > endTs) return false;
      return true;
    });

    return filtered.map(toBar).reverse();
  }

  async getLatestBar(symbol: string): Promise<Bar> {
    const bars = await this.getBars(symbol, "1Min", { limit: 1 });
    const bar = bars[0];
    if (!bar) {
      throw new Error(`No bar data for ${symbol}`);
    }
    return bar;
  }

  async getLatestBars(symbols: string[]): Promise<Record<string, Bar>> {
    const result: Record<string, Bar> = {};
    for (const symbol of symbols) {
      try {
        result[symbol] = await this.getLatestBar(symbol);
      } catch {}
    }
    return result;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const instId = toInstId(symbol);
    const [ticker] = await this.client.publicRequest<OkxTicker[]>("GET", "/api/v5/market/ticker", { instId });
    if (!ticker) {
      throw new Error(`No quote data for ${symbol}`);
    }
    return toQuote(ticker);
  }

  async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
    const tickers = await this.client.publicRequest<OkxTicker[]>("GET", "/api/v5/market/tickers", {
      instType: "SPOT",
    });
    const result: Record<string, Quote> = {};
    for (const symbol of symbols) {
      const instId = toInstId(symbol);
      const ticker = (tickers ?? []).find((entry) => entry.instId === instId);
      if (ticker) {
        result[symbol] = toQuote(ticker);
      }
    }
    return result;
  }

  async getSnapshot(symbol: string): Promise<Snapshot> {
    const instId = toInstId(symbol);

    const [ticker, minuteCandles, dailyCandles] = await Promise.all([
      this.client.publicRequest<OkxTicker[]>("GET", "/api/v5/market/ticker", { instId }),
      this.client.publicRequest<OkxCandleRaw[]>("GET", "/api/v5/market/candles", { instId, bar: "1m", limit: 1 }),
      this.client.publicRequest<OkxCandleRaw[]>("GET", "/api/v5/market/candles", { instId, bar: "1D", limit: 2 }),
    ]);

    const current = ticker?.[0];
    if (!current) {
      throw new Error(`No snapshot data for ${symbol}`);
    }

    const minuteRaw = minuteCandles?.[0];
    const dailyAsc = (dailyCandles ?? []).map(parseOkxCandle).reverse();
    const daily = dailyAsc[dailyAsc.length - 1] ?? null;
    const prevDaily = dailyAsc.length > 1 ? dailyAsc[0]! : daily;

    return {
      symbol: fromInstId(instId),
      latest_trade: {
        price: parseFloat(current.last) || 0,
        size: parseFloat(current.lastSz) || 0,
        timestamp: current.ts,
      },
      latest_quote: {
        symbol: fromInstId(instId),
        bid_price: parseFloat(current.bidPx) || 0,
        bid_size: parseFloat(current.bidSz) || 0,
        ask_price: parseFloat(current.askPx) || 0,
        ask_size: parseFloat(current.askSz) || 0,
        timestamp: msToIso(current.ts),
      },
      minute_bar: toBar(minuteRaw ? parseOkxCandle(minuteRaw) : EMPTY_CANDLE),
      daily_bar: toBar(daily),
      prev_daily_bar: toBar(prevDaily),
    };
  }

  async getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
    const result: Record<string, Snapshot> = {};
    for (const symbol of symbols) {
      try {
        result[symbol] = await this.getSnapshot(symbol);
      } catch {}
    }
    return result;
  }

  async getCryptoSnapshot(symbol: string): Promise<Snapshot> {
    return this.getSnapshot(symbol);
  }
}

export function createOkxMarketDataProvider(client: OkxClient): OkxMarketDataProvider {
  return new OkxMarketDataProvider(client);
}
