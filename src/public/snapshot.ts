/**
 * Public (unauthenticated) read-only view of the agent.
 *
 * Everything served on /api/public/* passes through these allowlists. Anything not
 * explicitly listed here — account identifiers, full strategy config, raw error
 * payloads, URLs — never leaves the worker.
 */

import type { LogEntry } from "../core/types";
import type { Account, Order, Position } from "../providers/types";
import type { AgentConfig } from "../schemas/agent-config";

export interface PublicAccount {
  equity: number;
  cash: number;
  buying_power: number;
  portfolio_value: number;
  currency: string;
}

export interface PublicOrder {
  symbol: string;
  side: "buy" | "sell";
  type: string;
  qty: number;
  filled_qty: number;
  filled_avg_price: number | null;
  status: string;
  submitted_at: string;
  filled_at: string | null;
}

/** Config fields the dashboard needs for rendering. Strategy thresholds stay private. */
const PUBLIC_CONFIG_KEYS = [
  "starting_equity",
  "max_positions",
  "crypto_enabled",
  "crypto_symbols",
  "options_enabled",
  "llm_model",
] as const;

export type PublicConfig = Partial<Pick<AgentConfig, (typeof PUBLIC_CONFIG_KEYS)[number]>>;

const SENSITIVE_LOG_KEY = /token|secret|key|password|passphrase|auth|signature|account|header|url|prompt|raw/i;
const MAX_LOG_STRING = 300;

/** Strip anything that looks like a credential from free text (error messages etc.). */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|key|token|secret|passphrase|signature|sig)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, "[redacted]");
}

export function toPublicAccount(account: Account | null): PublicAccount | null {
  if (!account) return null;
  return {
    equity: account.equity,
    cash: account.cash,
    buying_power: account.buying_power,
    portfolio_value: account.portfolio_value,
    currency: account.currency,
  };
}

export function toPublicPosition(position: Position) {
  return {
    symbol: position.symbol,
    asset_class: position.asset_class,
    side: position.side,
    qty: position.qty,
    avg_entry_price: position.avg_entry_price,
    current_price: position.current_price,
    market_value: position.market_value,
    unrealized_pl: position.unrealized_pl,
    unrealized_plpc: position.unrealized_plpc,
    change_today: position.change_today,
  };
}

export function toPublicConfig(config: AgentConfig): PublicConfig {
  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_CONFIG_KEYS) {
    if (config[key] !== undefined) result[key] = config[key];
  }
  return result as PublicConfig;
}

export function toPublicLogEntry(entry: LogEntry): LogEntry {
  const result: LogEntry = { timestamp: entry.timestamp, agent: entry.agent, action: entry.action };
  for (const [key, value] of Object.entries(entry)) {
    if (key in result || SENSITIVE_LOG_KEY.test(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] = redactSecrets(value).slice(0, MAX_LOG_STRING);
    }
    // Objects/arrays are dropped: they can carry raw provider payloads.
  }
  return result;
}

function toNumber(value: string | null | undefined): number {
  const parsed = value ? parseFloat(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toPublicOrder(order: Order): PublicOrder {
  const avg = toNumber(order.filled_avg_price);
  return {
    symbol: order.symbol,
    side: order.side,
    type: order.type || order.order_type,
    qty: toNumber(order.qty),
    filled_qty: toNumber(order.filled_qty),
    filled_avg_price: avg > 0 ? avg : null,
    status: order.status,
    submitted_at: order.submitted_at || order.created_at,
    filled_at: order.filled_at,
  };
}

/** Allowed portfolio-history periods for the public endpoint (prevents cache-key abuse). */
export const PUBLIC_HISTORY_PERIODS = new Set(["1D", "1W", "1M", "3M", "1A"]);
