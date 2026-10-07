export interface OkxCandle {
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
  volCcy: number;
  confirm: string;
}

export type OkxCandleRaw = [string, string, string, string, string, string, string, string, string];

export interface OkxTicker {
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  vol24h: string;
  volCcy24h: string;
  ts: string;
}

export interface OkxInstrument {
  instId: string;
  instType: string;
  state: string;
  lotSz: string;
  minSz: string;
  tickSz: string;
  /** Max base-currency size for a market order. */
  maxMktSz?: string;
  /** Max quote-currency amount for a market order. */
  maxMktAmt?: string;
  baseCcy: string;
  quoteCcy: string;
  ctVal?: string;
}

export interface OkxBalanceDetail {
  ccy: string;
  eq: string;
  availBal: string;
  availEq: string;
  frozenBal: string;
  eqUsd: string;
  liab?: string;
  upl?: string;
}

export interface OkxBalance {
  totalEq: string;
  adjEq: string;
  mgnRatio: string;
  isoEq: string;
  imr: string;
  mmr: string;
  uTime: string;
  details: OkxBalanceDetail[];
}

export interface OkxOrder {
  instId: string;
  ordId: string;
  clOrdId: string;
  side: string;
  ordType: string;
  px: string;
  sz: string;
  accFillSz: string;
  avgPx: string;
  state: string;
  ordStatus?: string;
  cTime: string;
  uTime: string;
  fillTime: string;
  fee: string;
  feeCcy: string;
  tpTriggerPx?: string;
  slTriggerPx?: string;
  tgtCcy?: string;
  sCode?: string;
  sMsg?: string;
}

const CASH_CCYS = new Set(["USDT", "USDC", "USD", "EUR"]);

/**
 * Quote currency used for "<BASE>/USD" strategy symbols (env OKX_QUOTE_CCY).
 * Global accounts usually hold USDT; EEA/US accounts hold USDC/USD/EUR instead.
 * OKX delisted most Crypto-USD spot pairs on 2026-09-30, so prefer USDC over USD.
 */
export const DEFAULT_OKX_QUOTE_CCY = "USDT";
const SUPPORTED_QUOTE_CCYS = new Set(["USDT", "USDC", "USD", "EUR"]);

export function resolveQuoteCcy(value: string | undefined): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && SUPPORTED_QUOTE_CCYS.has(normalized) ? normalized : DEFAULT_OKX_QUOTE_CCY;
}

export function toInstId(symbol: string, quoteCcy: string = DEFAULT_OKX_QUOTE_CCY): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.includes("-")) {
    return normalized;
  }
  const [base, quote] = normalized.split("/");
  if (!base || !quote) {
    return normalized;
  }
  const resolvedQuote = quote === "USD" ? quoteCcy : quote;
  return `${base}-${resolvedQuote}`;
}

export function fromInstId(instId: string, quoteCcy: string = DEFAULT_OKX_QUOTE_CCY): string {
  const parts = instId.toUpperCase().split("-");
  if (parts.length !== 2) {
    return instId;
  }
  const [base, quote] = parts;
  return `${base}/${quote === quoteCcy ? "USD" : quote}`;
}

export function isCashCurrency(ccy: string): boolean {
  return CASH_CCYS.has(ccy.toUpperCase());
}

export function formatQty(value: number, step: number): string {
  const decimals = decimalsOf(step);
  const floored = Math.floor(value / step) * step;
  return floored.toFixed(decimals);
}

export function formatPrice(value: number, step: number): string {
  const decimals = decimalsOf(step);
  return value.toFixed(decimals);
}

export function parseOkxCandle(raw: OkxCandleRaw): OkxCandle {
  return {
    ts: raw[0],
    o: parseFloat(raw[1]),
    h: parseFloat(raw[2]),
    l: parseFloat(raw[3]),
    c: parseFloat(raw[4]),
    vol: parseFloat(raw[5]),
    volCcy: parseFloat(raw[6]),
    confirm: raw[8],
  };
}

export function mapTimeframe(timeframe: string): string {
  const normalized = timeframe.toLowerCase().trim();
  const mappings: Record<string, string> = {
    "1m": "1m",
    "1min": "1m",
    "3m": "3m",
    "3min": "3m",
    "5m": "5m",
    "5min": "5m",
    "15m": "15m",
    "15min": "15m",
    "30m": "30m",
    "30min": "30m",
    "1h": "1H",
    "1hour": "1H",
    "2h": "2H",
    "2hour": "2H",
    "4h": "4H",
    "4hour": "4H",
    "6h": "6H",
    "12h": "12H",
    "1d": "1D",
    "1day": "1D",
    "1w": "1W",
    "1week": "1W",
    "1month": "1M",
  };
  return mappings[normalized] ?? normalized;
}

function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 8;
  }
  const str = String(step);
  if (str.includes("e-")) {
    const exponent = str.split("e-")[1];
    if (exponent) {
      return parseInt(exponent, 10);
    }
  }
  const parts = str.split(".");
  return parts.length > 1 ? parts[1]!.length : 0;
}

export function msToIso(ms: string | number): string {
  if (!ms) return "";
  const value = typeof ms === "number" ? ms : parseInt(ms, 10);
  if (Number.isNaN(value)) return "";
  return new Date(value).toISOString();
}
