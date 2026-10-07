import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";
import { createError, ErrorCode } from "../../lib/errors";
import type { CompletionParams, CompletionResult, LLMProvider } from "../types";
import { getRequestSettings, MODEL_CATALOG } from "./models";

/**
 * Supported AI SDK providers and their environment variable mapping
 */
export const SUPPORTED_PROVIDERS = {
  openai: { envKey: "OPENAI_API_KEY", name: "OpenAI" },
  anthropic: { envKey: "ANTHROPIC_API_KEY", name: "Anthropic" },
  google: { envKey: "GOOGLE_GENERATIVE_AI_API_KEY", name: "Google" },
  xai: { envKey: "XAI_API_KEY", name: "xAI (Grok)" },
  deepseek: { envKey: "DEEPSEEK_API_KEY", name: "DeepSeek" },
} as const;

export type SupportedProvider = keyof typeof SUPPORTED_PROVIDERS;

/**
 * Popular models per provider for dashboard UI
 */
export const PROVIDER_MODELS: Record<SupportedProvider, string[]> = {
  openai: MODEL_CATALOG.filter((m) => m.provider === "openai").map((m) => m.id),
  anthropic: MODEL_CATALOG.filter((m) => m.provider === "anthropic").map((m) => m.id),
  google: MODEL_CATALOG.filter((m) => m.provider === "google").map((m) => m.id),
  xai: MODEL_CATALOG.filter((m) => m.provider === "xai").map((m) => m.id),
  deepseek: MODEL_CATALOG.filter((m) => m.provider === "deepseek").map((m) => m.id),
};

export interface AISDKConfig {
  /** Model identifier in format "provider/model" (e.g., "openai/gpt-4o", "anthropic/claude-sonnet-4") */
  model: string;
  /** API keys for each provider */
  apiKeys: Partial<Record<SupportedProvider, string>>;
  /** Optional OpenAI base URL override (e.g., OpenAI-compatible proxy). */
  openaiBaseUrl?: string;
}

type ProviderFactory =
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createGoogleGenerativeAI>
  | ReturnType<typeof createXai>
  | ReturnType<typeof createDeepSeek>;

/**
 * AI SDK Provider - Supports multiple AI providers via Vercel AI SDK
 *
 * Supports 5 providers: OpenAI, Anthropic, Google, xAI, DeepSeek
 * Model format: "provider/model" (e.g., "openai/gpt-4o", "xai/grok-4")
 */
export class AISDKProvider implements LLMProvider {
  private providers: Partial<Record<SupportedProvider, ProviderFactory>>;
  private defaultModel: string;

  constructor(config: AISDKConfig) {
    this.providers = {};

    // Initialize providers based on available API keys
    if (config.apiKeys.openai) {
      const rawBaseUrl = config.openaiBaseUrl?.trim().replace(/\/+$/, "");
      const openaiOptions: { apiKey: string; baseURL?: string } = { apiKey: config.apiKeys.openai };
      if (rawBaseUrl) {
        openaiOptions.baseURL = rawBaseUrl;
      }
      this.providers.openai = createOpenAI(openaiOptions);
    }
    if (config.apiKeys.anthropic) {
      this.providers.anthropic = createAnthropic({ apiKey: config.apiKeys.anthropic });
    }
    if (config.apiKeys.google) {
      this.providers.google = createGoogleGenerativeAI({ apiKey: config.apiKeys.google });
    }
    if (config.apiKeys.xai) {
      this.providers.xai = createXai({ apiKey: config.apiKeys.xai });
    }
    if (config.apiKeys.deepseek) {
      this.providers.deepseek = createDeepSeek({ apiKey: config.apiKeys.deepseek });
    }

    if (Object.keys(this.providers).length === 0) {
      throw createError(ErrorCode.INVALID_INPUT, "At least one provider API key is required");
    }

    this.defaultModel = config.model;
  }

  /**
   * Get list of available providers based on configured API keys
   */
  getAvailableProviders(): SupportedProvider[] {
    return Object.keys(this.providers) as SupportedProvider[];
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    try {
      const modelSpec = params.model ?? this.defaultModel;

      // Parse provider/model format (supports both / and : separators)
      const separator = modelSpec.includes(":") ? ":" : "/";
      const parts = modelSpec.split(separator);
      const providerName = (parts[0] ?? "openai").toLowerCase() as SupportedProvider;
      const modelId = parts.slice(1).join(separator) || modelSpec;

      // Get provider instance
      const provider = this.providers[providerName];
      if (!provider) {
        const available = this.getAvailableProviders().join(", ");
        throw createError(
          ErrorCode.INVALID_INPUT,
          `Provider '${providerName}' not configured. Available: ${available}`
        );
      }

      // Reasoning models reject custom temperature and need room for thinking tokens.
      const settings = getRequestSettings(`${providerName}/${modelId}`, {
        temperature: params.temperature,
        maxTokens: params.max_tokens,
      });
      const result = await generateText({
        model: provider(modelId),
        messages: params.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        ...(settings.temperature !== undefined && { temperature: settings.temperature }),
        maxOutputTokens: settings.maxTokens,
      });

      return {
        content: result.text,
        usage: {
          prompt_tokens: result.usage?.inputTokens ?? 0,
          completion_tokens: result.usage?.outputTokens ?? 0,
          total_tokens: result.usage?.totalTokens ?? 0,
        },
      };
    } catch (error) {
      throw createError(ErrorCode.PROVIDER_ERROR, `AI SDK error: ${String(error)}`);
    }
  }
}

/** Legacy config format for backward compatibility */
export interface LegacyAISDKConfig {
  model: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export function createAISDKProvider(config: AISDKConfig | LegacyAISDKConfig): AISDKProvider {
  // Handle legacy config format
  if ("openaiApiKey" in config || "anthropicApiKey" in config) {
    const legacyConfig = config as LegacyAISDKConfig;
    return new AISDKProvider({
      model: legacyConfig.model,
      apiKeys: {
        openai: legacyConfig.openaiApiKey,
        anthropic: legacyConfig.anthropicApiKey,
      },
    });
  }
  return new AISDKProvider(config as AISDKConfig);
}
