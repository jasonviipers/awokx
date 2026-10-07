import { createError, ErrorCode } from "../../lib/errors";
import type { CompletionParams, CompletionResult, LLMProvider } from "../types";
import { DEFAULT_RESEARCH_MODEL, getRequestSettings } from "./models";

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_RESEARCH_MODEL;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const model = params.model ?? this.model;
    const settings = getRequestSettings(model, { temperature: params.temperature, maxTokens: params.max_tokens });
    const body: Record<string, unknown> = { model, messages: params.messages };
    if (settings.temperature === undefined) {
      // Reasoning models reject temperature and the legacy max_tokens field.
      body.max_completion_tokens = settings.maxTokens;
    } else {
      body.temperature = settings.temperature;
      body.max_tokens = settings.maxTokens;
    }

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw createError(ErrorCode.PROVIDER_ERROR, `OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAIResponse;

    const content = data.choices[0]?.message?.content ?? "";

    return {
      content,
      usage: {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      },
    };
  }
}

export function createOpenAIProvider(config: OpenAIConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}
