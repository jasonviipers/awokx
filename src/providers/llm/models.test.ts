import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANALYST_MODEL,
  DEFAULT_RESEARCH_MODEL,
  estimateCostUsd,
  findModel,
  getRequestSettings,
  isReasoningModel,
  MODEL_CATALOG,
  REASONING_MIN_OUTPUT_TOKENS,
} from "./models";

describe("model catalog", () => {
  it("offers 2-4 models per provider with unique ids", () => {
    const byProvider = new Map<string, number>();
    for (const model of MODEL_CATALOG) byProvider.set(model.provider, (byProvider.get(model.provider) ?? 0) + 1);
    for (const count of byProvider.values()) {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(4);
    }
    const keys = MODEL_CATALOG.map((m) => `${m.provider}/${m.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every provider has a research and an analyst option", () => {
    for (const provider of ["openai", "anthropic", "google", "xai", "deepseek"]) {
      const models = MODEL_CATALOG.filter((m) => m.provider === provider);
      expect(models.some((m) => m.tier !== "smart")).toBe(true);
      expect(models.some((m) => m.tier !== "cheap")).toBe(true);
    }
  });

  it("defaults point at catalog models", () => {
    expect(findModel(DEFAULT_RESEARCH_MODEL)).toBeDefined();
    expect(findModel(DEFAULT_ANALYST_MODEL)).toBeDefined();
  });

  it("resolves provider prefixes and gateway aliases", () => {
    expect(findModel("gpt-6-luna")?.provider).toBe("openai");
    expect(findModel("anthropic/claude-opus-5-5")?.inputPerM).toBe(4);
    expect(findModel("google-ai-studio/gemini-3.8-flash")?.provider).toBe("google");
    expect(findModel("grok/grok-4.7")?.provider).toBe("xai");
  });
});

describe("request settings", () => {
  it("omits temperature and raises the token floor for reasoning models", () => {
    expect(getRequestSettings("anthropic/claude-opus-5-5", { temperature: 0.3, maxTokens: 250 })).toEqual({
      maxTokens: REASONING_MIN_OUTPUT_TOKENS,
    });
  });

  it("keeps temperature and token limit for non-reasoning models", () => {
    expect(getRequestSettings("anthropic/claude-haiku-4-5", { temperature: 0.3, maxTokens: 250 })).toEqual({
      temperature: 0.3,
      maxTokens: 250,
    });
  });

  it("classifies models outside the catalog by name", () => {
    expect(isReasoningModel("gpt-4o")).toBe(false);
    expect(isReasoningModel("openai/gpt-5.5")).toBe(true);
    expect(isReasoningModel("anthropic/claude-opus-4-8")).toBe(true);
  });
});

describe("cost estimate", () => {
  it("uses catalog pricing", () => {
    expect(estimateCostUsd("gpt-6-luna", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(estimateCostUsd("anthropic/claude-opus-5-5", 1_000_000, 0)).toBeCloseTo(4);
  });
});
