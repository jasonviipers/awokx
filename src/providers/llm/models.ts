/**
 * Single source of truth for the LLMs VIIPERS offers.
 *
 * The dashboard model pickers (GET /agent/models), the AI SDK provider list, request
 * shaping (temperature / token limits) and LLM cost tracking all read from here.
 * To add or retire a model, edit MODEL_CATALOG only.
 *
 * Verified against each provider's official model docs on 2026-10-07.
 */

export type ModelProvider = "openai" | "anthropic" | "google" | "xai" | "deepseek";

export interface ModelInfo {
  provider: ModelProvider;
  /** Provider's API model ID (without the "provider/" prefix). */
  id: string;
  label: string;
  /** "smart" = analyst picker, "cheap" = research picker, "both" = shown in both. */
  tier: "smart" | "cheap" | "both";
  /** USD per 1M tokens (standard tier, short prompts). */
  inputPerM: number;
  outputPerM: number;
  /**
   * Reasoning models spend output tokens on thinking and reject custom sampling
   * (temperature), so requests must omit it and allow a larger output budget.
   */
  reasoning: boolean;
}

/** Ordered newest/most capable first within each provider. */
export const MODEL_CATALOG: readonly ModelInfo[] = [
  // OpenAI — developers.openai.com/api/docs/models
  {
    provider: "openai",
    id: "gpt-6-astra",
    label: "GPT-6 Astra (best)",
    tier: "smart",
    inputPerM: 10,
    outputPerM: 50,
    reasoning: true,
  },
  {
    provider: "openai",
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    tier: "both",
    inputPerM: 2,
    outputPerM: 10,
    reasoning: true,
  },
  {
    provider: "openai",
    id: "gpt-6-luna",
    label: "GPT-6 Luna (cheapest)",
    tier: "cheap",
    inputPerM: 0.1,
    outputPerM: 0.5,
    reasoning: true,
  },

  // Anthropic — platform.claude.com model table
  {
    provider: "anthropic",
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1 (best)",
    tier: "smart",
    inputPerM: 10,
    outputPerM: 50,
    reasoning: true,
  },
  {
    provider: "anthropic",
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    tier: "smart",
    inputPerM: 4,
    outputPerM: 20,
    reasoning: true,
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    tier: "both",
    inputPerM: 2,
    outputPerM: 10,
    reasoning: true,
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5 (cheapest)",
    tier: "cheap",
    inputPerM: 1,
    outputPerM: 5,
    reasoning: false,
  },

  // Google — ai.google.dev/gemini-api/docs/models (2.0 shut down, 2.5 restricted)
  {
    provider: "google",
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash (best)",
    tier: "both",
    inputPerM: 0.75,
    outputPerM: 3.75,
    reasoning: true,
  },
  {
    provider: "google",
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (preview)",
    tier: "smart",
    inputPerM: 2,
    outputPerM: 12,
    reasoning: true,
  },
  {
    provider: "google",
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite (cheapest)",
    tier: "cheap",
    inputPerM: 0.3,
    outputPerM: 2.5,
    reasoning: true,
  },

  // xAI — docs.x.ai/docs/models (grok-3 / grok-4 retired)
  {
    provider: "xai",
    id: "grok-4.7",
    label: "Grok 4.7 (best)",
    tier: "smart",
    inputPerM: 2,
    outputPerM: 6,
    reasoning: true,
  },
  { provider: "xai", id: "grok-4.6", label: "Grok 4.6", tier: "smart", inputPerM: 2, outputPerM: 6, reasoning: true },
  {
    provider: "xai",
    id: "grok-4.3",
    label: "Grok 4.3 (cheapest)",
    tier: "cheap",
    inputPerM: 1.25,
    outputPerM: 2.5,
    reasoning: true,
  },

  // DeepSeek — api-docs.deepseek.com pricing (peak-hour rates)
  {
    provider: "deepseek",
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro (best)",
    tier: "smart",
    inputPerM: 1.32,
    outputPerM: 3.96,
    reasoning: true,
  },
  {
    provider: "deepseek",
    id: "deepseek-flash",
    label: "DeepSeek V4.1 Flash (cheapest)",
    tier: "both",
    inputPerM: 0.3,
    outputPerM: 1.2,
    reasoning: true,
  },
];

/** Defaults for the default "openai-raw" provider (bare OpenAI IDs). */
export const DEFAULT_RESEARCH_MODEL = "gpt-6-luna";
export const DEFAULT_ANALYST_MODEL = "gpt-6.1-sol";

/** Output-token floor for reasoning models: thinking tokens count against the limit. */
export const REASONING_MIN_OUTPUT_TOKENS = 8000;

/** Rates used for cost tracking when a model isn't in the catalog. */
const FALLBACK_PRICING = { inputPerM: 2.5, outputPerM: 10 };

const PROVIDER_ALIASES: Record<string, ModelProvider> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "google-ai-studio": "google",
  xai: "xai",
  grok: "xai",
  deepseek: "deepseek",
};

/** Accepts "id", "provider/id" or "provider:id"; bare IDs are treated as OpenAI. */
export function parseModelSpec(spec: string): { provider: ModelProvider | null; id: string } {
  const separator = spec.includes("/") ? "/" : spec.includes(":") ? ":" : null;
  if (!separator) return { provider: "openai", id: spec };
  const [prefix, ...rest] = spec.split(separator);
  return { provider: PROVIDER_ALIASES[(prefix ?? "").toLowerCase()] ?? null, id: rest.join(separator) };
}

export function findModel(spec: string): ModelInfo | undefined {
  const { provider, id } = parseModelSpec(spec);
  return MODEL_CATALOG.find((model) => model.id === id && (provider === null || model.provider === provider));
}

/**
 * Whether a model rejects custom temperature / thinks before answering. Falls back to
 * name patterns so models outside the catalog are still sent valid requests.
 */
export function isReasoningModel(spec: string): boolean {
  const known = findModel(spec);
  if (known) return known.reasoning;
  const { provider, id } = parseModelSpec(spec);
  if (provider === "openai") return /^(gpt-[5-9]|gpt-\d{2}|o\d)/.test(id);
  if (provider === "anthropic") return !/haiku|claude-3/.test(id);
  return false;
}

/** Request settings that are valid for the given model. */
export function getRequestSettings(
  spec: string,
  requested: { temperature?: number; maxTokens?: number }
): { temperature?: number; maxTokens: number } {
  const maxTokens = requested.maxTokens ?? 1024;
  if (isReasoningModel(spec)) {
    return { maxTokens: Math.max(maxTokens, REASONING_MIN_OUTPUT_TOKENS) };
  }
  return { temperature: requested.temperature ?? 0.7, maxTokens };
}

export function estimateCostUsd(spec: string, tokensIn: number, tokensOut: number): number {
  const rates = findModel(spec) ?? FALLBACK_PRICING;
  return (tokensIn * rates.inputPerM + tokensOut * rates.outputPerM) / 1_000_000;
}
