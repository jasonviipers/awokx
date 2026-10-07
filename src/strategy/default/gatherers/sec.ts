/**
 * SEC EDGAR gatherer — 8-K and other filings from the SEC EDGAR ATOM feed.
 */

import type { Signal } from "../../../core/types";
import { createAlpacaProviders } from "../../../providers/alpaca";
import { parseSECAtomFeed } from "../../../providers/news/sec-atom";
import type { Gatherer, StrategyContext } from "../../types";
import { SOURCE_CONFIG } from "../config";
import { tickerCache } from "../helpers/ticker";

// ── XML / feed helpers ───────────────────────────────────────────────────────

function calculateSECFreshness(updatedDate: string): number {
  const ageMs = Date.now() - new Date(updatedDate).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours < 1) return 1.0;
  if (ageHours < 4) return 0.9;
  if (ageHours < 12) return 0.7;
  if (ageHours < 24) return 0.5;
  return 0.3;
}

// ── Company name → ticker resolution ─────────────────────────────────────────

const companyToTickerCache = new Map<string, string | null>();

async function resolveTickerFromCompanyName(companyName: string): Promise<string | null> {
  const normalized = companyName.toUpperCase().trim();

  if (companyToTickerCache.has(normalized)) {
    return companyToTickerCache.get(normalized) ?? null;
  }

  try {
    const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": "Viipers Trading Bot" },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;

    for (const entry of Object.values(data)) {
      const entryTitle = entry.title.toUpperCase();
      if (entryTitle === normalized || normalized.includes(entryTitle) || entryTitle.includes(normalized)) {
        companyToTickerCache.set(normalized, entry.ticker);
        return entry.ticker;
      }
    }

    const firstWord = normalized.split(/[\s,]+/)[0];
    for (const entry of Object.values(data)) {
      if (entry.title.toUpperCase().startsWith(firstWord || "")) {
        companyToTickerCache.set(normalized, entry.ticker);
        return entry.ticker;
      }
    }

    companyToTickerCache.set(normalized, null);
    return null;
  } catch {
    return null;
  }
}

// ── Gatherer ─────────────────────────────────────────────────────────────────

async function gatherSECFilings(ctx: StrategyContext): Promise<Signal[]> {
  const signals: Signal[] = [];

  try {
    const response = await fetch(
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom",
      {
        headers: {
          "User-Agent": "Viipers Trading Bot (contact@example.com)",
          Accept: "application/atom+xml",
        },
      }
    );

    if (!response.ok) {
      ctx.log("SEC", "fetch_error", { status: response.status });
      return signals;
    }

    const text = await response.text();
    const entries = parseSECAtomFeed(text).filter((entry) => entry.form && entry.company);

    const alpaca = createAlpacaProviders(ctx.env);

    for (const entry of entries.slice(0, 15)) {
      const ticker = await resolveTickerFromCompanyName(entry.company);
      if (!ticker) continue;

      const cached = tickerCache.getCachedValidation(ticker);
      if (cached === false) continue;
      if (cached === undefined) {
        const isValid = await tickerCache.validateWithAlpaca(ticker, alpaca);
        if (!isValid) continue;
      }

      const sourceWeight = entry.form === "8-K" ? SOURCE_CONFIG.weights.sec_8k : SOURCE_CONFIG.weights.sec_4;
      const freshness = calculateSECFreshness(entry.updated);

      const sentiment = entry.form === "8-K" ? 0.3 : 0.2;
      const weightedSentiment = sentiment * sourceWeight * freshness;

      signals.push({
        symbol: ticker,
        source: "sec_edgar",
        source_detail: `sec_${entry.form.toLowerCase().replace("-", "")}`,
        sentiment: weightedSentiment,
        raw_sentiment: sentiment,
        volume: 1,
        freshness,
        source_weight: sourceWeight,
        reason: `SEC ${entry.form}: ${entry.company.slice(0, 50)}`,
        timestamp: Date.now(),
      });
    }

    ctx.log("SEC", "gathered_signals", { count: signals.length });
  } catch (error) {
    ctx.log("SEC", "error", { message: String(error) });
  }

  return signals;
}

export const secGatherer: Gatherer = {
  name: "sec",
  gather: gatherSECFilings,
};
