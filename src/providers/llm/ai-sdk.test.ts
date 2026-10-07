import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../../lib/errors";

// Mock the AI SDK modules
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn((model: string) => ({ provider: "openai", model }))),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((model: string) => ({ provider: "anthropic", model }))),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn((model: string) => ({ provider: "google", model }))),
}));

vi.mock("@ai-sdk/xai", () => ({
  createXai: vi.fn(() => vi.fn((model: string) => ({ provider: "xai", model }))),
}));

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: vi.fn(() => vi.fn((model: string) => ({ provider: "deepseek", model }))),
}));

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
// Import after mocks
import { generateText } from "ai";
import { AISDKProvider, createAISDKProvider, PROVIDER_MODELS, SUPPORTED_PROVIDERS } from "./ai-sdk";

const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

describe("AI SDK Provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: "Test response",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("SUPPORTED_PROVIDERS", () => {
    it("contains all expected providers", () => {
      expect(Object.keys(SUPPORTED_PROVIDERS)).toEqual(["openai", "anthropic", "google", "xai", "deepseek"]);
    });

    it("has correct env keys", () => {
      expect(SUPPORTED_PROVIDERS.openai.envKey).toBe("OPENAI_API_KEY");
      expect(SUPPORTED_PROVIDERS.anthropic.envKey).toBe("ANTHROPIC_API_KEY");
      expect(SUPPORTED_PROVIDERS.google.envKey).toBe("GOOGLE_GENERATIVE_AI_API_KEY");
      expect(SUPPORTED_PROVIDERS.xai.envKey).toBe("XAI_API_KEY");
      expect(SUPPORTED_PROVIDERS.deepseek.envKey).toBe("DEEPSEEK_API_KEY");
    });
  });

  describe("PROVIDER_MODELS", () => {
    it("contains models for all providers", () => {
      expect(PROVIDER_MODELS.openai).toContain("gpt-6.1-sol");
      expect(PROVIDER_MODELS.anthropic).toContain("claude-opus-5-5");
      expect(PROVIDER_MODELS.google).toContain("gemini-3.8-flash");
      expect(PROVIDER_MODELS.xai).toContain("grok-4.7");
      expect(PROVIDER_MODELS.deepseek).toContain("deepseek-v4-pro");
    });
  });

  describe("createAISDKProvider", () => {
    it("creates provider with OpenAI API key", () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    });

    it("creates provider with Anthropic API key", () => {
      const provider = createAISDKProvider({
        model: "anthropic/claude-sonnet-4",
        apiKeys: { anthropic: "sk-ant-test" },
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
    });

    it("creates provider with Google API key", () => {
      const provider = createAISDKProvider({
        model: "google/gemini-2.5-pro",
        apiKeys: { google: "google-test" },
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: "google-test" });
    });

    it("creates provider with xAI API key", () => {
      const provider = createAISDKProvider({
        model: "xai/grok-4",
        apiKeys: { xai: "xai-test" },
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createXai).toHaveBeenCalledWith({ apiKey: "xai-test" });
    });

    it("creates provider with DeepSeek API key", () => {
      const provider = createAISDKProvider({
        model: "deepseek/deepseek-chat",
        apiKeys: { deepseek: "deepseek-test" },
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createDeepSeek).toHaveBeenCalledWith({ apiKey: "deepseek-test" });
    });

    it("creates provider with multiple API keys", () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: {
          openai: "sk-test",
          anthropic: "sk-ant-test",
          google: "google-test",
        },
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
      expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: "google-test" });
    });

    it("throws when no API keys provided", () => {
      expect(() =>
        createAISDKProvider({
          model: "openai/gpt-4o",
          apiKeys: {},
        })
      ).toThrow();
    });

    it("supports legacy config format with openaiApiKey", () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        openaiApiKey: "sk-legacy",
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-legacy" });
    });

    it("supports legacy config format with anthropicApiKey", () => {
      const provider = createAISDKProvider({
        model: "anthropic/claude-sonnet-4",
        anthropicApiKey: "sk-ant-legacy",
      });
      expect(provider).toBeInstanceOf(AISDKProvider);
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-legacy" });
    });
  });

  describe("getAvailableProviders", () => {
    it("returns list of configured providers", () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: {
          openai: "sk-test",
          anthropic: "sk-ant-test",
        },
      });
      const available = provider.getAvailableProviders();
      expect(available).toContain("openai");
      expect(available).toContain("anthropic");
      expect(available).not.toContain("google");
    });

    it("returns single provider when only one configured", () => {
      const provider = createAISDKProvider({
        model: "google/gemini-2.5-pro",
        apiKeys: { google: "google-test" },
      });
      const available = provider.getAvailableProviders();
      expect(available).toEqual(["google"]);
    });
  });

  describe("complete", () => {
    it("calls generateText with correct parameters", async () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockGenerateText).toHaveBeenCalledOnce();
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Hello" }],
          temperature: 0.7,
          maxOutputTokens: 1024,
        })
      );
    });

    it("passes system messages via `system` (AI SDK v7 rejects them inside messages)", async () => {
      const provider = createAISDKProvider({
        model: "google/gemini-3.8-flash",
        apiKeys: { google: "test-key" },
      });

      await provider.complete({
        messages: [
          { role: "system", content: "You are a trading analyst." },
          { role: "system", content: "Reply in JSON." },
          { role: "user", content: "Analyze NVDA" },
        ],
      });

      const call = mockGenerateText.mock.calls.at(-1)![0];
      expect(call.system).toBe("You are a trading analyst.\n\nReply in JSON.");
      expect(call.messages).toEqual([{ role: "user", content: "Analyze NVDA" }]);
      expect(call.messages.some((m: { role: string }) => m.role === "system")).toBe(false);
    });

    it("omits `system` when there are no system messages", async () => {
      const provider = createAISDKProvider({ model: "openai/gpt-4o", apiKeys: { openai: "sk-test" } });
      await provider.complete({ messages: [{ role: "user", content: "Hi" }] });
      expect(mockGenerateText.mock.calls.at(-1)![0]).not.toHaveProperty("system");
    });

    it("returns completion result with content and usage", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "Test response",
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      });

      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      const result = await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.content).toBe("Test response");
      expect(result.usage).toEqual({
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
      });
    });

    it("uses default model when not specified in params", async () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o-mini",
        apiKeys: { openai: "sk-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: "openai", model: "gpt-4o-mini" }),
        })
      );
    });

    it("uses model from params when specified", async () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o-mini",
        apiKeys: { openai: "sk-test" },
      });

      await provider.complete({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: "openai", model: "gpt-4o" }),
        })
      );
    });

    it("uses custom temperature when provided", async () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.5,
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
        })
      );
    });

    it("uses custom max_tokens when provided", async () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 2048,
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxOutputTokens: 2048,
        })
      );
    });

    it("throws PROVIDER_ERROR when provider not configured", async () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      await expect(
        provider.complete({
          model: "anthropic/claude-sonnet-4",
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
        message: expect.stringContaining("not configured"),
      });
    });

    it("throws PROVIDER_ERROR when generateText fails", async () => {
      mockGenerateText.mockRejectedValueOnce(new Error("API error"));

      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      await expect(
        provider.complete({
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
        message: expect.stringContaining("AI SDK error"),
      });
    });

    it("handles missing usage in response", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "Response without usage",
      });

      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      const result = await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });

    it("parses model with colon separator", async () => {
      const provider = createAISDKProvider({
        model: "openai:gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: "openai", model: "gpt-4o" }),
        })
      );
    });

    it("fails when model has no provider prefix (uses model as provider name)", async () => {
      const provider = createAISDKProvider({
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-test" },
      });

      await expect(
        provider.complete({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Test" }],
        })
      ).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
        message: expect.stringContaining("gpt-4o"),
      });
    });

    it("works with Anthropic provider", async () => {
      const provider = createAISDKProvider({
        model: "anthropic/claude-sonnet-4",
        apiKeys: { anthropic: "sk-ant-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: "anthropic", model: "claude-sonnet-4" }),
        })
      );
    });

    it("works with Google provider", async () => {
      const provider = createAISDKProvider({
        model: "google/gemini-2.5-pro",
        apiKeys: { google: "google-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: "google", model: "gemini-2.5-pro" }),
        })
      );
    });

    it("works with xAI provider", async () => {
      const provider = createAISDKProvider({
        model: "xai/grok-4",
        apiKeys: { xai: "xai-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: "xai", model: "grok-4" }),
        })
      );
    });

    it("works with DeepSeek provider", async () => {
      const provider = createAISDKProvider({
        model: "deepseek/deepseek-chat",
        apiKeys: { deepseek: "deepseek-test" },
      });

      await provider.complete({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ provider: "deepseek", model: "deepseek-chat" }),
        })
      );
    });
  });
});
