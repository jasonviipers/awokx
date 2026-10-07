import { createError, ErrorCode } from "../../lib/errors";
import type { CompletionParams, CompletionResult, LLMProvider } from "../types";
import { DEFAULT_RESEARCH_MODEL, getRequestSettings } from "./models";

export interface CloudflareGatewayConfig {
  /** Cloudflare account ID (used in gateway URL) */
  accountId: string;
  /** AI Gateway ID/name (used in gateway URL) */
  gatewayId: string;
  /** Cloudflare AI Gateway token (cf-aig-authorization) */
  token: string;
  /** Default model in format "provider/model" (e.g., "openai/gpt-4o-mini") */
  model?: string;
}

interface OpenAICompatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function normalizeCloudflareCompatModel(model: string): string {
  const idx = model.indexOf("/");
  if (idx === -1) {
    // Cloudflare /compat requires {provider}/{model}; default to OpenAI for unqualified ids.
    return `openai/${model}`;
  }

  const provider = model.slice(0, idx).toLowerCase();
  const rest = model.slice(idx + 1);

  const mappedProvider =
    provider === "google"
      ? "google-ai-studio"
      : provider === "xai"
        ? "grok"
        : provider === "workersai"
          ? "workers-ai"
          : provider;

  // Cloudflare /compat docs show Anthropic versions with hyphens (e.g., ...-4-5),
  // while some configs may use dots (e.g., ...-4.5).
  let mappedRest = rest;
  if (mappedProvider === "anthropic") {
    mappedRest = mappedRest.replace(/-(\d+)\.(\d+)$/, "-$1-$2");
  }

  return `${mappedProvider}/${mappedRest}`;
}

/**
 * Cloudflare AI Gateway Provider - OpenAI-compatible unified access to multiple providers.
 *
 * Uses Cloudflare AI Gateway "/compat" endpoint:
 *   https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions
 *
 * Auth (BYOK / Unified Billing):
 *   cf-aig-authorization: Bearer <token>
 */
export class CloudflareGatewayProvider implements LLMProvider {
  private baseUrl: string;
  private token: string;
  private model: string;

  constructor(config: CloudflareGatewayConfig) {
    if (!config.accountId) {
      throw createError(ErrorCode.INVALID_INPUT, "CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID required for Cloudflare AI Gateway");
    }
    if (!config.gatewayId) {
      throw createError(ErrorCode.INVALID_INPUT, "CLOUDFLARE_AI_GATEWAY_ID required for Cloudflare AI Gateway");
    }
    if (!config.token) {
      throw createError(ErrorCode.INVALID_INPUT, "CLOUDFLARE_AI_GATEWAY_TOKEN required for Cloudflare AI Gateway");
    }

    this.baseUrl = `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/compat`;
    this.token = config.token;
    this.model = config.model ?? `openai/${DEFAULT_RESEARCH_MODEL}`;
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const model = normalizeCloudflareCompatModel(params.model ?? this.model);
    const settings = getRequestSettings(model, { temperature: params.temperature, maxTokens: params.max_tokens });
    const body: Record<string, unknown> = { model, messages: params.messages, max_tokens: settings.maxTokens };
    // Reasoning models reject custom temperature.
    if (settings.temperature !== undefined) {
      body.temperature = settings.temperature;
    }

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-aig-authorization": `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw createError(ErrorCode.PROVIDER_ERROR, `Cloudflare AI Gateway network error: ${String(error)}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw createError(ErrorCode.PROVIDER_ERROR, `Cloudflare AI Gateway error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAICompatResponse;
    const content = data.choices?.[0]?.message?.content ?? "";

    return {
      content,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      },
    };
  }
}

export function createCloudflareGatewayProvider(config: CloudflareGatewayConfig): CloudflareGatewayProvider {
  return new CloudflareGatewayProvider(config);
}
