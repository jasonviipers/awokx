import { createError, ErrorCode } from "../../lib/errors";

/** Recommended REST domain since 2026-05-20 (www.okx.com still works). */
export const OKX_DEFAULT_BASE_URL = "https://openapi.okx.com";

const REQUEST_TIMEOUT_MS = 10_000;

export interface OkxClientConfig {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  baseUrl?: string;
  simulated?: boolean;
}

interface OkxResponse<T> {
  code: string;
  msg: string;
  data: T;
}

type QueryParams = Record<string, string | number | boolean | undefined>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * OKX v5 signature: Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body)).
 * For GET requests the query string is part of requestPath.
 */
export async function okxSign(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  secret: string
): Promise<string> {
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  const keyData = new TextEncoder().encode(secret);
  const messageData = new TextEncoder().encode(prehash);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  return toBase64(new Uint8Array(signature));
}

const INSUFFICIENT_BALANCE_CODES = new Set([51008, 51119, 51127, 51131]);
const NOT_FOUND_CODES = new Set([51400, 51401, 51402, 51603]);
const INVALID_INPUT_CODES = new Set([50000, 50014, 51000, 51001, 51020]);

export function mapBusinessCode(code: string): ErrorCode {
  const value = Number(code);
  // 50100-50114: API key frozen, bad key/passphrase/sign/timestamp, IP not whitelisted,
  // or a live key used against demo trading (50101).
  if (value >= 50100 && value <= 50114) return ErrorCode.UNAUTHORIZED;
  if (value === 50011 || value === 50061) return ErrorCode.RATE_LIMITED;
  if (INSUFFICIENT_BALANCE_CODES.has(value)) return ErrorCode.INSUFFICIENT_BUYING_POWER;
  if (NOT_FOUND_CODES.has(value)) return ErrorCode.NOT_FOUND;
  if (INVALID_INPUT_CODES.has(value)) return ErrorCode.INVALID_INPUT;
  return ErrorCode.PROVIDER_ERROR;
}

function buildQuery(params: QueryParams): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }
  return searchParams.toString();
}

function resolveBaseUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl || OKX_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw createError(ErrorCode.INVALID_INPUT, `Invalid OKX_API_BASE_URL: ${raw}`);
  }
  // Credentials are sent in headers on every private call; never allow plaintext transport.
  if (parsed.protocol !== "https:") {
    throw createError(ErrorCode.INVALID_INPUT, "OKX_API_BASE_URL must use https://");
  }
  return parsed.origin;
}

export class OkxClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private apiPassphrase: string;
  private simulated: boolean;

  constructor(config: OkxClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.apiPassphrase = config.apiPassphrase;
    this.simulated = config.simulated ?? false;
    this.baseUrl = resolveBaseUrl(config.baseUrl);
  }

  async publicRequest<T>(method: string, path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(false, method, path, params);
  }

  async privateRequest<T>(
    method: string,
    path: string,
    params?: QueryParams,
    body?: Record<string, unknown> | Record<string, unknown>[]
  ): Promise<T> {
    return this.request<T>(true, method, path, params, body);
  }

  private async request<T>(
    authenticated: boolean,
    method: string,
    path: string,
    params?: QueryParams,
    body?: Record<string, unknown> | Record<string, unknown>[]
  ): Promise<T> {
    const queryString = params ? buildQuery(params) : "";
    const requestPath = queryString ? `${path}?${queryString}` : path;
    const url = `${this.baseUrl}${requestPath}`;
    const bodyString = body ? JSON.stringify(body) : "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authenticated) {
      if (!this.apiKey || !this.apiSecret || !this.apiPassphrase) {
        throw createError(ErrorCode.UNAUTHORIZED, "OKX credentials are not configured");
      }
      const timestamp = new Date().toISOString();
      const sign = await okxSign(timestamp, method, requestPath, bodyString, this.apiSecret);
      headers["OK-ACCESS-KEY"] = this.apiKey;
      headers["OK-ACCESS-SIGN"] = sign;
      headers["OK-ACCESS-TIMESTAMP"] = timestamp;
      headers["OK-ACCESS-PASSPHRASE"] = this.apiPassphrase;
    }

    // Demo trading applies to both public and private endpoints.
    if (this.simulated) {
      headers["x-simulated-trading"] = "1";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: bodyString ? bodyString : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 500);
      if (response.status === 401 || response.status === 403) {
        throw createError(ErrorCode.UNAUTHORIZED, `OKX authentication failed: ${errorBody}`);
      }
      if (response.status === 404) {
        throw createError(ErrorCode.NOT_FOUND, `OKX resource not found: ${errorBody}`);
      }
      if (response.status === 429) {
        throw createError(ErrorCode.RATE_LIMITED, `OKX rate limit exceeded: ${errorBody}`);
      }
      throw createError(ErrorCode.PROVIDER_ERROR, `OKX API error (${response.status}): ${errorBody}`);
    }

    const json = (await response.json()) as OkxResponse<T>;

    if (!json || json.code !== "0") {
      // code "1"/"2" = all/partial operations failed; the real reason is per-item sCode/sMsg.
      const item = Array.isArray(json?.data)
        ? (json.data as Array<{ sCode?: string; sMsg?: string }>).find((d) => d?.sCode && d.sCode !== "0")
        : undefined;
      const code = item?.sCode ?? json?.code ?? "unknown";
      const message = item?.sMsg || json?.msg || "";
      const errorCode = code === "unknown" ? ErrorCode.PROVIDER_ERROR : mapBusinessCode(code);
      throw createError(errorCode, `OKX API error (${code}): ${message}`, { code });
    }

    return json.data;
  }
}

export function createOkxClient(config: OkxClientConfig): OkxClient {
  return new OkxClient(config);
}
