import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ProxyAgent } from "undici";
import { normalizePromptWhitespace } from "../context/context-optimizer.js";

export type ApiSaverProvider = "openai" | "claude";

export interface ApiSaverModelInput {
  provider: ApiSaverProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ApiSaverModelConfig {
  provider: ApiSaverProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_API_BASE_URL = "https://api.apisaver.com/v1";
const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

function normalizeOpenAIBaseURL(value?: string): string {
  const raw = trimTrailingSlash(value?.trim() || DEFAULT_API_BASE_URL);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("API 地址无效，请填写完整的 http:// 或 https:// 地址");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API 地址仅支持 http:// 或 https:// 协议");
  }
  return /\/v1$/i.test(raw) ? raw : `${raw}/v1`;
}

/** Wire protocol actually spoken on the network. Legacy stored values such as
 * "responses" collapse to the OpenAI-compatible transport. */
export type ApiWireMode = "openai" | "anthropic";

const DEFAULT_ANTHROPIC_ROOT = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export function normalizeWireMode(value: unknown): ApiWireMode {
  return String(value ?? "").trim().toLowerCase() === "anthropic" ? "anthropic" : "openai";
}

/** Anthropic addresses are stored as a root, because `/v1/messages` and
 * `/v1/models` hang off it. Users paste all three shapes, so accept them all. */
function normalizeAnthropicRoot(value?: string): string {
  const raw = trimTrailingSlash(value?.trim() || DEFAULT_ANTHROPIC_ROOT);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("API 地址无效，请填写完整的 http:// 或 https:// 地址");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API 地址仅支持 http:// 或 https:// 协议");
  }
  return trimTrailingSlash(raw.replace(/\/v1(?:\/messages)?$/i, ""));
}

// OpenAI's Chat Completions API only accepts these four efforts, so "max"
// saturates at "high". Anthropic instead takes an explicit thinking budget,
// which is where the stronger levels become meaningful.
const openAIReasoningEffort: Record<string, string> = { minimal: "minimal", low: "low", medium: "medium", high: "high", max: "high" };
const anthropicThinkingBudget: Record<string, number> = { low: 2048, medium: 6144, high: 12288, max: 24576 };

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const isQuotaExceeded = (value: string): boolean => /quota\s+(?:has\s+been\s+)?exceeded|insufficient[\s_-]*quota|billing[\s_-]*(?:limit|quota)|余额不足|额度(?:已)?用尽/i.test(value);

function supportsOpenAIJsonMode(model: string): boolean {
  // Gemini's OpenAI-compatible adapters commonly reject response_format at
  // the upstream gateway, even though a plain chat completion works.
  return !/^gemini(?:[-:/]|$)/iu.test(model.trim());
}

function supportsOpenAIReasoning(model: string): boolean {
  return /^(?:gpt-|o\d|chatgpt-)/iu.test(model.trim());
}

/** Relays report the actionable part of a failure inside a JSON envelope.
 * Surfacing it verbatim is the difference between "请求失败（400）" and
 * "model not found", which is what the user actually needs to fix. */
function upstreamErrorText(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "";
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const error = parsed.error && typeof parsed.error === "object" ? parsed.error as Record<string, unknown> : parsed;
    const message = [error.message, error.detail, parsed.message, error.type]
      .find(value => typeof value === "string" && value.trim());
    return typeof message === "string" ? message.trim().replace(/\s+/g, " ").slice(0, 240) : "";
  } catch {
    return "";
  }
}

function protocolHint(status: number, mode: ApiWireMode): string {
  if (status === 404) {
    return mode === "anthropic"
      ? "。当前为 Anthropic Messages 模式，请确认接口地址支持 /v1/messages；若这是 OpenAI 兼容中转站，请把 API 格式切换回 OpenAI"
      : "。当前为 OpenAI 兼容模式，请确认接口地址支持 /v1/chat/completions；若这是 Anthropic 官方或 Claude 专用地址，请把 API 格式切换为 Anthropic Messages";
  }
  if (status === 401 || status === 403) {
    return mode === "anthropic"
      ? "。Anthropic Messages 模式使用 x-api-key 认证，请确认该 Key 支持此地址"
      : "。OpenAI 兼容模式使用 Authorization: Bearer 认证，请确认该 Key 支持此地址";
  }
  return "";
}

function apiErrorMessage(status: number, detail: string, statusText: string, attempts: number, routeHint = "", requestHint = "", mode: ApiWireMode = "openai"): string {
  const retrySuffix = attempts > 1 ? `，已自动重试 ${attempts - 1} 次` : "";
  const upstream = upstreamErrorText(detail);
  if (isQuotaExceeded(detail)) {
    return `API 中转服务额度已用尽${routeHint}。章节正文已保存，本章记忆将在额度恢复后再更新。`;
  }
  if ([502, 503, 504, 524].includes(status)) {
    const compact = upstream || (detail.trim().startsWith("<") ? "" : detail.trim().replace(/\s+/g, " ").slice(0, 180));
    return `API 中转服务当前返回 ${status}（可能来自代理或 API 上游网关）${requestHint}${routeHint}${retrySuffix}${compact ? `：${compact}` : ""}`;
  }
  if (status === 429) return `API 中转服务请求过于频繁${routeHint}${retrySuffix}，请稍后再试。${upstream ? `上游说明：${upstream}` : ""}`.trim();
  if (status === 401 || status === 403) return `API Key 或模型权限校验失败（${status}）${routeHint}${protocolHint(status, mode)}${upstream ? `。上游说明：${upstream}` : "，请在设置中检查配置。"}`;

  const compact = upstream || (detail.trim().startsWith("<")
    ? "服务返回了网页错误页面"
    : detail.trim().replace(/\s+/g, " ").slice(0, 240));
  return `API Saver 请求失败（${status}）${routeHint}${requestHint}${protocolHint(status, mode)}：${compact || statusText || "未知错误"}`;
}

export function buildModelConfig(input: ApiSaverModelInput): ApiSaverModelConfig {
  const anthropicBaseURL = trimTrailingSlash(input.baseUrl?.trim() || "https://api.apisaver.com");
  const baseUrl = input.provider === "openai"
    ? normalizeOpenAIBaseURL(input.baseUrl)
    : anthropicBaseURL.endsWith("/messages") ? anthropicBaseURL : `${anthropicBaseURL}/v1/messages`;
  return {
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
    baseUrl,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
  };
}

export function createChatModel(config: ApiSaverModelConfig): BaseChatModel {
  if (config.provider === "openai") {
    return new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      configuration: { baseURL: config.baseUrl },
    });
  }
  return new ChatAnthropic({
    anthropicApiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens ?? 4096,
    clientOptions: { baseURL: config.baseUrl },
  });
}

// Simple client for direct API calls
export interface ApiSaverClientConfig {
  apiKey: string;
  apiKeys?: string[];
  baseURL?: string;
  defaultModel?: string;
  apiMode?: ApiWireMode | "responses";
  reasoningMode?: string;
  contextWindowKB?: number;
  proxyEnabled?: boolean;
  proxyURL?: string;
  proxyBypassLocal?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" | "text" };
  retryAttempts?: number;
}

export interface ApiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface RuntimeUsageSummary extends Required<ApiUsage> {
  requests: number;
  startedAt: string;
}

export interface DiagnosticCheck {
  id: "address" | "keys" | "proxy" | "models" | "model" | "chat";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DiagnosticReport {
  mode: ApiWireMode;
  modelsEndpoint: string;
  chatEndpoint: string;
  checks: DiagnosticCheck[];
}

export interface GatewayUsageSnapshot {
  fetchedAt: string;
  status?: Record<string, unknown>;
  pricing?: Array<Record<string, unknown>>;
  accounts: Array<{ keyIndex: number; keyHint: string; usage?: Record<string, unknown>; logs: Array<Record<string, unknown>>; error?: string }>;
  errors: string[];
}

const runtimeUsage: RuntimeUsageSummary = {
  inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0,
  cacheWriteTokens: 0, reasoningTokens: 0, requests: 0, startedAt: new Date().toISOString(),
};

function recordRuntimeUsage(usage?: ApiUsage): void {
  if (!usage) return;
  runtimeUsage.inputTokens += usage.inputTokens || 0;
  runtimeUsage.outputTokens += usage.outputTokens || 0;
  runtimeUsage.totalTokens += usage.totalTokens || 0;
  runtimeUsage.cachedInputTokens += usage.cachedInputTokens || 0;
  runtimeUsage.cacheWriteTokens += usage.cacheWriteTokens || 0;
  runtimeUsage.reasoningTokens += usage.reasoningTokens || 0;
  runtimeUsage.requests += 1;
}

export function getRuntimeUsageSummary(): RuntimeUsageSummary {
  return { ...runtimeUsage };
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseUsage(value: unknown): ApiUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const prompt = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const input = usage.input_tokens_details as Record<string, unknown> | undefined;
  const completion = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const output = usage.output_tokens_details as Record<string, unknown> | undefined;
  const result: ApiUsage = {
    inputTokens: numeric(usage.prompt_tokens) ?? numeric(usage.input_tokens),
    outputTokens: numeric(usage.completion_tokens) ?? numeric(usage.output_tokens),
    totalTokens: numeric(usage.total_tokens),
    cachedInputTokens: numeric(prompt?.cached_tokens) ?? numeric(input?.cached_tokens) ?? numeric(usage.cache_read_input_tokens) ?? numeric(usage.cached_tokens) ?? numeric(usage.prompt_cache_hit_tokens),
    cacheWriteTokens: numeric(prompt?.cache_write_tokens) ?? numeric(input?.cache_write_tokens) ?? numeric(usage.cache_creation_input_tokens),
    reasoningTokens: numeric(completion?.reasoning_tokens) ?? numeric(output?.reasoning_tokens),
  };
  if (result.totalTokens === undefined && result.inputTokens !== undefined && result.outputTokens !== undefined) {
    result.totalTokens = result.inputTokens + result.outputTokens;
  }
  return Object.values(result).some(value => value !== undefined) ? result : undefined;
}

/** Anthropic splits usage across `message_start` (input) and `message_delta`
 * (output), so streaming totals have to accumulate instead of overwrite. */
function mergeUsage(base: ApiUsage | undefined, next: ApiUsage | undefined): ApiUsage | undefined {
  if (!next) return base;
  if (!base) return next;
  const merged: ApiUsage = { ...base };
  for (const [field, value] of Object.entries(next) as Array<[keyof ApiUsage, number | undefined]>) {
    if (value !== undefined) merged[field] = value;
  }
  if (merged.inputTokens !== undefined && merged.outputTokens !== undefined) {
    merged.totalTokens = merged.inputTokens + merged.outputTokens;
  }
  return merged;
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(item => extractText(item)).filter(Boolean).join("\n");
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  return "";
}

function emptyCompletionError(data: Record<string, unknown>, maxTokens: number): Error {
  const choice = Array.isArray(data.choices) && data.choices[0] && typeof data.choices[0] === "object"
    ? data.choices[0] as Record<string, unknown>
    : undefined;
  const message = choice?.message && typeof choice.message === "object"
    ? choice.message as Record<string, unknown>
    : undefined;
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "";
  if (finishReason === "length") {
    return new Error(`API Saver 模型输出被截断（max_tokens=${maxTokens}），请重试或提高输出上限`);
  }
  const reasoningLength = [message?.reasoning_content, message?.reasoning]
    .find(value => typeof value === "string");
  if (typeof reasoningLength === "string" && reasoningLength.length > 0) {
    return new Error("API Saver 只返回了推理内容，没有正文；请关闭推理模式或提高输出上限");
  }
  const topKeys = Object.keys(data).slice(0, 12).join(",");
  const choiceKeys = choice ? Object.keys(choice).slice(0, 12).join(",") : "";
  return new Error(`API Saver 返回内容为空（响应字段：${topKeys || "无"}；choice：${choiceKeys || "无"}）`);
}

/** Anthropic keeps the system prompt out of the turn list and rejects a
 * conversation that does not start with a user turn, so fold both rules in
 * here rather than at every call site. */
function toAnthropicMessages(messages: ChatMessage[]): { system: string; turns: Array<{ role: "user" | "assistant"; content: string }> } {
  const system = messages
    .filter(message => message.role === "system" && message.content.trim())
    .map(message => message.content)
    .join("\n\n");
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    if (message.role === "system" || !message.content.trim()) continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const previous = turns[turns.length - 1];
    if (previous?.role === role) previous.content = `${previous.content}\n\n${message.content}`;
    else turns.push({ role, content: message.content });
  }
  if (!turns.length) turns.push({ role: "user", content: system || "继续" });
  if (turns[0].role === "assistant") turns.unshift({ role: "user", content: "请继续。" });
  return { system, turns };
}

/** Only `text` blocks are prose. `thinking` and `tool_use` blocks share the
 * array and must not leak into a chapter. */
function anthropicText(value: unknown): string {
  if (!Array.isArray(value)) return extractText(value);
  return value
    .filter((block): block is Record<string, unknown> => Boolean(block && typeof block === "object"))
    .filter(block => block.type === "text")
    .map(block => typeof block.text === "string" ? block.text : "")
    .join("");
}

function emptyAnthropicError(data: Record<string, unknown>, maxTokens: number): Error {
  const stopReason = typeof data.stop_reason === "string" ? data.stop_reason : "";
  if (stopReason === "max_tokens") {
    return new Error(`API Saver 模型输出被截断（max_tokens=${maxTokens}），请重试或提高输出上限`);
  }
  const blocks = Array.isArray(data.content) ? data.content : [];
  const kinds = blocks
    .filter((block): block is Record<string, unknown> => Boolean(block && typeof block === "object"))
    .map(block => String(block.type ?? "unknown"));
  if (kinds.length && !kinds.includes("text")) {
    return new Error(`Anthropic 接口只返回了 ${kinds.join("/")} 块，没有正文；请降低思考强度或提高输出上限`);
  }
  return new Error(`Anthropic 接口返回内容为空（stop_reason：${stopReason || "无"}；响应字段：${Object.keys(data).slice(0, 12).join(",") || "无"}）`);
}

const proxyAgents = new Map<string, ProxyAgent>();
// API keys can belong to different relay groups. `/v1/models` is scoped to
// the authenticated key, so retain this association instead of flattening all
// models into one list and accidentally sending a Gemini model through a
// Claude-only key.
const modelsByApiKey = new Map<string, Set<string>>();
const modelLookupInFlight = new Map<string, Promise<Set<string> | undefined>>();

export function resetModelKeyRoutingCache(): void {
  modelsByApiKey.clear();
  modelLookupInFlight.clear();
}

export function seedModelKeyRoutingCache(key: string, models: string[], baseURL = DEFAULT_API_BASE_URL, apiMode: ApiWireMode | "responses" = "openai"): void {
  const endpoint = normalizeWireMode(apiMode) === "anthropic"
    ? `${normalizeAnthropicRoot(baseURL)}/v1/models`
    : `${normalizeOpenAIBaseURL(baseURL)}/models`;
  modelsByApiKey.set(`${endpoint}\n${key}`, new Set(models));
}

const isPrivateOrLocalHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1" || host.startsWith("127.")) return true;
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
};

const proxyURLForRequest = (targetURL: string, config: Pick<ApiSaverClientConfig, "proxyEnabled" | "proxyURL" | "proxyBypassLocal">) => {
  if (!config.proxyEnabled || !config.proxyURL?.trim()) return "";
  try {
    const proxy = new URL(config.proxyURL.trim());
    const target = new URL(targetURL);
    if (!/^https?:$/i.test(proxy.protocol)) return "";
    if (config.proxyBypassLocal === true && isPrivateOrLocalHost(target.hostname)) return "";
    return proxy.toString();
  } catch {
    return "";
  }
};

const proxyDispatcherFor = (targetURL: string, config: Pick<ApiSaverClientConfig, "proxyEnabled" | "proxyURL" | "proxyBypassLocal">) => {
  const proxyURL = proxyURLForRequest(targetURL, config);
  if (!proxyURL) return undefined;
  const existing = proxyAgents.get(proxyURL);
  if (existing) return existing;
  const agent = new ProxyAgent(proxyURL);
  proxyAgents.set(proxyURL, agent);
  return agent;
};

const proxyRouteHint = (targetURL: string, config: Pick<ApiSaverClientConfig, "proxyEnabled" | "proxyURL" | "proxyBypassLocal">) => {
  const proxyURL = proxyURLForRequest(targetURL, config);
  if (!proxyURL) return "";
  try {
    const proxy = new URL(proxyURL);
    return `，已通过代理 ${proxy.protocol}//${proxy.host}`;
  } catch {
    return "，已通过应用代理";
  }
};

function limitMessagesToKB(messages: ChatMessage[], contextWindowKB?: number): ChatMessage[] {
  // Final transport-level pass catches raw document fields that bypassed the
  // context packer. It affects only the request payload, never local files.
  const normalizedMessages = messages.map(message => ({
    ...message,
    content: normalizePromptWhitespace(message.content),
  }));
  const budget = Math.floor(Number(contextWindowKB || 0) * 1024);
  if (!budget || normalizedMessages.reduce((sum, message) => sum + message.content.length, 0) <= budget) return normalizedMessages;
  let remaining = budget;
  return normalizedMessages.map(message => {
    if (remaining <= 0) return { ...message, content: "" };
    const content = message.content.length <= remaining
      ? message.content
      : remaining <= 4096
        ? message.content.slice(0, remaining)
        : `${message.content.slice(0, remaining - 2048)}\n...[上下文已按 KB 限制截断]...\n${message.content.slice(-2048)}`;
    remaining -= content.length;
    return { ...message, content };
  }).filter(message => message.content.trim());
}

export class ApiSaverClient {
  private config: ApiSaverClientConfig;

  constructor(config: ApiSaverClientConfig) {
    this.config = config;
  }

  private get wireMode(): ApiWireMode {
    return normalizeWireMode(this.config.apiMode);
  }

  /** Resolved network addresses. Exposed through `describeRoute` so error text
   * and the settings diagnostics can name the exact URL that was called. */
  private endpoints(): { models: string; chat: string } {
    if (this.wireMode === "anthropic") {
      const root = normalizeAnthropicRoot(this.config.baseURL);
      return { models: `${root}/v1/models`, chat: `${root}/v1/messages` };
    }
    const base = normalizeOpenAIBaseURL(this.config.baseURL);
    return { models: `${base}/models`, chat: `${base}/chat/completions` };
  }

  private authHeaders(key: string): Record<string, string> {
    return this.wireMode === "anthropic"
      ? { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION }
      : { Authorization: `Bearer ${key}` };
  }

  describeRoute(): { mode: ApiWireMode; models: string; chat: string } {
    return { mode: this.wireMode, ...this.endpoints() };
  }

  private async modelsForKey(key: string): Promise<Set<string> | undefined> {
    const endpoint = this.endpoints().models;
    const cacheKey = `${endpoint}\n${key}`;
    const cached = modelsByApiKey.get(cacheKey);
    if (cached) return cached;
    const inflight = modelLookupInFlight.get(cacheKey);
    if (inflight) return inflight;
    const lookup = (async () => {
      try {
        const dispatcher = proxyDispatcherFor(endpoint, this.config);
        const response = await fetch(endpoint, {
          headers: { ...this.authHeaders(key), Accept: "application/json" },
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
        if (!response.ok) return undefined;
        const payload = await response.json() as { data?: Array<{ id?: string } | string>; models?: Array<{ id?: string } | string> };
        const models = new Set((payload.data ?? payload.models ?? [])
          .map(item => typeof item === "string" ? item : item.id)
          .filter((model): model is string => Boolean(model)));
        modelsByApiKey.set(cacheKey, models);
        return models;
      } catch {
        // Do not turn a temporary models endpoint failure into a hard writing
        // failure. The real completion request still has its normal retries.
        return undefined;
      } finally {
        modelLookupInFlight.delete(cacheKey);
      }
    })();
    modelLookupInFlight.set(cacheKey, lookup);
    return lookup;
  }

  private async keysForModel(keys: string[], model: string): Promise<string[]> {
    if (keys.length <= 1) return keys;
    // This happens once per key per runtime and survives all later chapter,
    // outline, card and streaming calls. It also works after an app restart,
    // before the user has manually pressed “拉取模型”.
    const known = await Promise.all(keys.map(async key => ({ key, models: await this.modelsForKey(key) })));
    const matched = known.filter(item => item.models?.has(model)).map(item => item.key);
    if (matched.length) return matched;
    const unavailable = known.filter(item => !item.models).map(item => item.key);
    if (!unavailable.length) {
      throw new Error(`当前配置的 API Key 都不支持模型 ${model}。请在模型配置中重新拉取模型，并选择该模型所在分组对应的 API Key。`);
    }
    // A transient model-list outage must not stop a request outright. Only
    // unverified keys remain as a last-resort fallback; known wrong keys are
    // explicitly excluded.
    return unavailable;
  }

  async listModels(): Promise<string[]> {
    const endpoint = this.endpoints().models;
    const keys = Array.from(new Set([this.config.apiKey, ...(this.config.apiKeys || [])].map(key => key.trim()).filter(Boolean)));
    if (!keys.length) throw new Error("缺少 API Key");
    const results = await Promise.allSettled(keys.map(async key => {
      const models = await this.modelsForKey(key);
      if (!models) throw new Error(`模型列表请求失败：${endpoint}`);
      return [...models];
    }));
    const models = Array.from(new Set(results.flatMap(result => result.status === "fulfilled" ? result.value : [])));
    if (!models.length) {
      const errors = results.flatMap(result => result.status === "rejected" ? [String(result.reason)] : []);
      throw new Error(errors.length ? `所有 API Key 拉取模型失败：${errors.join("；")}` : "接口没有返回可用模型");
    }
    return models;
  }

  /** Raw model-list probe. `modelsForKey` deliberately swallows failures so a
   * transient outage cannot break writing; diagnostics need the opposite. */
  private async probeModels(key: string, endpoint: string): Promise<{ models?: string[]; error?: string }> {
    try {
      const dispatcher = proxyDispatcherFor(endpoint, this.config);
      const response = await fetch(endpoint, {
        headers: { ...this.authHeaders(key), Accept: "application/json" },
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
      const raw = await response.text();
      if (!response.ok) {
        return { error: apiErrorMessage(response.status, raw, response.statusText, 1, proxyRouteHint(endpoint, this.config), `，${endpoint}`, this.wireMode) };
      }
      const payload = JSON.parse(raw) as { data?: Array<{ id?: string } | string>; models?: Array<{ id?: string } | string> };
      const models = (payload.data ?? payload.models ?? [])
        .map(item => typeof item === "string" ? item : item.id)
        .filter((model): model is string => Boolean(model));
      modelsByApiKey.set(`${endpoint}\n${key}`, new Set(models));
      return { models };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Preflight for the settings screen: resolves the address, authenticates
   * every key, verifies the selected model exists and runs one real
   * completion, reporting the upstream text for whichever step fails. */
  async diagnose(model?: string): Promise<DiagnosticReport> {
    const mode = this.wireMode;
    const checks: DiagnosticCheck[] = [];
    let route: { models: string; chat: string };
    try {
      route = this.endpoints();
    } catch (error) {
      return {
        mode, modelsEndpoint: "", chatEndpoint: "",
        checks: [{ id: "address", label: "接口地址", status: "fail", detail: error instanceof Error ? error.message : String(error) }],
      };
    }
    checks.push({
      id: "address", label: "接口地址", status: "pass",
      detail: `${mode === "anthropic" ? "Anthropic Messages" : "OpenAI 兼容"} · ${route.chat}`,
    });

    const keys = Array.from(new Set([this.config.apiKey, ...(this.config.apiKeys || [])].map(key => key.trim()).filter(Boolean)));
    checks.push(keys.length
      ? { id: "keys", label: "API 密钥", status: "pass", detail: `已配置 ${keys.length} 个 Key，认证方式 ${mode === "anthropic" ? "x-api-key" : "Authorization: Bearer"}` }
      : { id: "keys", label: "API 密钥", status: "fail", detail: "没有配置任何 API Key" });

    if (this.config.proxyEnabled) {
      const resolved = proxyURLForRequest(route.chat, this.config);
      checks.push(resolved
        ? { id: "proxy", label: "网络代理", status: "pass", detail: `请求将通过 ${resolved}` }
        : { id: "proxy", label: "网络代理", status: "warn", detail: "代理已启用但对该地址未生效：代理地址无效，或命中了“本地地址不走代理”规则" });
    }
    if (!keys.length) return { mode, modelsEndpoint: route.models, chatEndpoint: route.chat, checks };

    const probes = await Promise.all(keys.map(async key => ({ key, ...await this.probeModels(key, route.models) })));
    const reachable = probes.filter(probe => probe.models);
    const available = Array.from(new Set(reachable.flatMap(probe => probe.models ?? [])));
    checks.push(reachable.length
      ? {
        id: "models", label: "模型列表", status: reachable.length === keys.length ? "pass" : "warn",
        detail: `${reachable.length}/${keys.length} 个 Key 可用，共 ${available.length} 个模型${reachable.length === keys.length ? "" : `。失败原因：${probes.filter(probe => probe.error).map(probe => `Key ${probe.key.slice(0, 4)}••• ${probe.error}`).join("；")}`}`,
      }
      : { id: "models", label: "模型列表", status: "fail", detail: probes.map(probe => probe.error).filter(Boolean).join("；") || `无法读取 ${route.models}` });

    const target = (model || this.config.defaultModel || "").trim();
    if (!target) {
      checks.push({ id: "model", label: "当前模型", status: "fail", detail: `还没有选择模型${available.length ? `。可用模型示例：${available.slice(0, 6).join("、")}` : ""}` });
      return { mode, modelsEndpoint: route.models, chatEndpoint: route.chat, checks };
    }
    checks.push(!available.length
      ? { id: "model", label: "当前模型", status: "warn", detail: `无法核对 ${target}：模型列表不可用` }
      : available.includes(target)
        ? { id: "model", label: "当前模型", status: "pass", detail: `${target} 在接口返回的模型列表中` }
        : { id: "model", label: "当前模型", status: "fail", detail: `接口没有提供 ${target}。可用模型示例：${available.slice(0, 6).join("、")}${available.length > 6 ? " 等" : ""}` });

    try {
      const probe = await this.chat([{ role: "user", content: "请只回复 OK" }], { model: target, max_tokens: 256, temperature: 0, retryAttempts: 1 });
      checks.push({ id: "chat", label: "实际调用", status: "pass", detail: `${route.chat} 返回正常（模型 ${probe.model}）` });
    } catch (error) {
      checks.push({ id: "chat", label: "实际调用", status: "fail", detail: error instanceof Error ? error.message : String(error) });
    }
    return { mode, modelsEndpoint: route.models, chatEndpoint: route.chat, checks };
  }

  /** Read-only dashboard data exposed by New API for the currently configured
   * relay keys. These endpoints deliberately authenticate each key on its own,
   * so the app never needs a dashboard cookie and cannot see another user. */
  async getGatewayUsageSnapshot(): Promise<GatewayUsageSnapshot> {
    const root = "https://api.apisaver.com";
    const endpoint = (path: string) => `${root}${path}`;
    const keys = Array.from(new Set([this.config.apiKey, ...(this.config.apiKeys || [])]
      .map(key => key.trim()).filter(Boolean)));
    if (!keys.length) throw new Error("请先在设置中填写 API Key。");
    const requestJSON = async (path: string, key?: string): Promise<Record<string, unknown>> => {
      const url = endpoint(path);
      const dispatcher = proxyDispatcherFor(url, this.config);
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
      const body = await response.text();
      if (!response.ok) throw new Error(`${path} 请求失败（${response.status}）：${body.replace(/\s+/g, " ").slice(0, 180)}`);
      try { return JSON.parse(body) as Record<string, unknown>; }
      catch { throw new Error(`${path} 没有返回 JSON 数据`); }
    };
    const [statusResult, accountResults] = await Promise.all([
      requestJSON("/api/status").catch(error => ({ __error: String(error) })),
      Promise.all(keys.map(async (key, keyIndex) => {
        const keyHint = `${key.slice(0, 4)}••••${key.slice(-4)}`;
        const [usageResult, logsResult, pricingResult] = await Promise.allSettled([
          requestJSON("/api/usage/token", key),
          requestJSON("/api/log/token", key),
          requestJSON("/api/pricing", key),
        ]);
        const failures = [usageResult, logsResult, pricingResult]
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map(result => String(result.reason));
        const usagePayload = usageResult.status === "fulfilled" ? usageResult.value : undefined;
        const logsPayload = logsResult.status === "fulfilled" ? logsResult.value : undefined;
        const pricingPayload = pricingResult.status === "fulfilled" ? pricingResult.value : undefined;
        const logs = Array.isArray(logsPayload?.data) ? logsPayload.data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
        return {
          keyIndex,
          keyHint,
          usage: usagePayload && typeof usagePayload.data === "object" && usagePayload.data ? usagePayload.data as Record<string, unknown> : undefined,
          logs,
          pricing: Array.isArray(pricingPayload?.data) ? pricingPayload.data.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [],
          group: usagePayload?.data && typeof usagePayload.data === "object" && typeof (usagePayload.data as Record<string, unknown>).group === "string" ? String((usagePayload.data as Record<string, unknown>).group) : undefined,
          groupRatios: pricingPayload?.group_ratio && typeof pricingPayload.group_ratio === "object" ? pricingPayload.group_ratio as Record<string, number> : undefined,
          usableGroups: pricingPayload?.usable_group && typeof pricingPayload.usable_group === "object" ? pricingPayload.usable_group as Record<string, unknown> : undefined,
          ...(failures.length ? { error: failures.join("；") } : {}),
        };
      })),
    ]);
    const errors = [statusResult.__error].filter((value): value is string => typeof value === "string");
    const statusPayload = statusResult as Record<string, unknown>;
    const statusData = statusPayload["data"];
    const pricing = accountResults.flatMap(account => account.pricing || []).filter((item, index, all) => all.findIndex(other => String(other.model_name) === String(item.model_name)) === index);
    return {
      fetchedAt: new Date().toISOString(),
      status: statusData && typeof statusData === "object" ? statusData as Record<string, unknown> : undefined,
      pricing,
      accounts: accountResults,
      errors,
    };
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<{ content: string; model: string; usage?: ApiUsage }> {
    const model = options.model || this.config.defaultModel || "gpt-4o-mini";
    const mode = this.wireMode;
    const contextMessages = limitMessagesToKB(messages, this.config.contextWindowKB);
    const configuredKeys = Array.from(new Set([this.config.apiKey, ...(this.config.apiKeys || [])].map(key => key.trim()).filter(Boolean)));
    const apiKeys = await this.keysForModel(configuredKeys, model);
    const reasoningMode = this.config.reasoningMode;
    const thinkingBudget = mode === "anthropic" && reasoningMode ? anthropicThinkingBudget[reasoningMode] : undefined;
    // Anthropic rejects a thinking budget that is not strictly below max_tokens.
    const maxTokens = Math.max(options.max_tokens ?? 4000, thinkingBudget ? thinkingBudget + 1024 : 0);
    const endpoint = this.endpoints().chat;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let body: string;

    if (mode === "anthropic") {
      const { system, turns } = toAnthropicMessages(contextMessages);
      body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: turns,
        // Extended thinking pins temperature at 1, so the caller's value has to
        // be dropped rather than sent and rejected.
        temperature: thinkingBudget ? undefined : options.temperature ?? 0.7,
        thinking: thinkingBudget ? { type: "enabled", budget_tokens: thinkingBudget } : undefined,
      });
    } else {
      body = JSON.stringify({
        model,
        messages: contextMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: maxTokens,
        // Gemini models use this same route but do not consistently implement
        // response_format. Prompt-level JSON rules remain in place.
        response_format: supportsOpenAIJsonMode(model) ? options.response_format : undefined,
        reasoning_effort: supportsOpenAIReasoning(model) && reasoningMode ? openAIReasoningEffort[reasoningMode] : undefined,
      });
    }
    const maxAttempts = Math.max(1, Math.min(5, options.retryAttempts ?? 3));
    let lastNetworkError = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const requestKey = apiKeys[(attempt - 1) % Math.max(1, apiKeys.length)] || this.config.apiKey;
        const requestHeaders = { ...headers, ...this.authHeaders(requestKey) };
        const dispatcher = proxyDispatcherFor(endpoint, this.config);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: requestHeaders,
          body,
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
        if (response.ok) {
          const data = await response.json() as Record<string, unknown>;
          if (mode === "anthropic") {
            const content = anthropicText(data.content);
            if (!content) throw emptyAnthropicError(data, maxTokens);
            const anthropicUsage = parseUsage(data.usage);
            recordRuntimeUsage(anthropicUsage);
            return { content, model: typeof data.model === "string" ? data.model : model, usage: anthropicUsage };
          }
          const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
          const firstChoice = choices[0];
          const firstMessage = firstChoice?.message as Record<string, unknown> | undefined;
          const content = extractText(firstMessage?.content) || extractText(firstChoice?.text);
          if (!content) throw emptyCompletionError(data, maxTokens);
          const usage = parseUsage(data.usage);
          recordRuntimeUsage(usage);
          return { content, model: typeof data.model === "string" ? data.model : model, usage };
        }

        const detail = await response.text();
        const retryable = [408, 429, 500, 502, 503, 504, 524].includes(response.status) && !isQuotaExceeded(detail);
        if (retryable && attempt < maxAttempts) {
          // Some upstream OpenAI-compatible adapters turn unsupported optional
          // fields into a 503. Retry the same task once with only core fields.
          if (response.status === 503 && attempt === 1) {
            try {
              const compatibilityBody = JSON.parse(body) as Record<string, unknown>;
              delete compatibilityBody.response_format;
              delete compatibilityBody.reasoning_effort;
              delete compatibilityBody.thinking;
              body = JSON.stringify(compatibilityBody);
            } catch { /* The original request remains valid for the next retry. */ }
          }
          await sleep(800 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(apiErrorMessage(response.status, detail, response.statusText, attempt, proxyRouteHint(endpoint, this.config), `，模型 ${model} · ${endpoint}`, mode));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("API ")) throw error;
        lastNetworkError = message;
        if (attempt < maxAttempts) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
      }
    }
    throw new Error(`无法连接 API 中转服务，已自动重试 ${maxAttempts - 1} 次：${lastNetworkError || "网络连接失败"}`);
  }

  async chatStream(messages: ChatMessage[], options: ChatOptions = {}, onChunk?: (chunk: string) => void): Promise<{ content: string; model: string; usage?: ApiUsage }> {
    // Streaming always uses the same wire protocol as the non-streaming path.
    // Never let a stale protocol selection silently degrade writing to a
    // non-streaming request.
    const model = options.model || this.config.defaultModel || "gpt-4o-mini";
    const mode = this.wireMode;
    const endpoint = this.endpoints().chat;
    const contextMessages = limitMessagesToKB(messages, this.config.contextWindowKB);
    const dispatcher = proxyDispatcherFor(endpoint, this.config);
    const configuredKeys = Array.from(new Set([this.config.apiKey, ...(this.config.apiKeys || [])].map(key => key.trim()).filter(Boolean)));
    const apiKeys = await this.keysForModel(configuredKeys, model);
    if (!apiKeys.length) throw new Error("缺少 API Key");
    const reasoningMode = this.config.reasoningMode;
    const thinkingBudget = mode === "anthropic" && reasoningMode ? anthropicThinkingBudget[reasoningMode] : undefined;
    const maxTokens = Math.max(options.max_tokens ?? 4000, thinkingBudget ? thinkingBudget + 1024 : 0);
    const streamBody = mode === "anthropic"
      ? (() => {
        const { system, turns } = toAnthropicMessages(contextMessages);
        return JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: system || undefined,
          messages: turns,
          temperature: thinkingBudget ? undefined : options.temperature ?? 0.7,
          thinking: thinkingBudget ? { type: "enabled", budget_tokens: thinkingBudget } : undefined,
          stream: true,
        });
      })()
      : JSON.stringify({ model, messages: contextMessages, temperature: options.temperature ?? 0.7, max_tokens: maxTokens, response_format: supportsOpenAIJsonMode(model) ? options.response_format : undefined, reasoning_effort: supportsOpenAIReasoning(model) && reasoningMode ? openAIReasoningEffort[reasoningMode] : undefined, stream: true, stream_options: { include_usage: true } });
    let response: Response | null = null;
    let lastStreamError = "";
    for (const key of apiKeys) {
      const candidate = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders(key) },
        body: streamBody,
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
      if (candidate.ok && candidate.body) {
        response = candidate;
        break;
      }
      const detail = await candidate.text();
      lastStreamError = apiErrorMessage(candidate.status, detail, candidate.statusText, 1, proxyRouteHint(endpoint, this.config), `，模型 ${model} · ${endpoint}`, mode);
    }
    const responseBody = response?.body;
    if (!responseBody) throw new Error(lastStreamError || "所有 API Key 的流式请求均失败");
    const reader = responseBody.getReader(); const decoder = new TextDecoder(); let buffer = ""; let content = ""; let usage: ApiUsage | undefined;
    try {
      streamLoop: while (true) {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE 首个响应超时")), content ? 45000 : 30000)),
        ]); if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          const text = line.trim().replace(/^data:\s*/, "");
          if (!text || line.trim().startsWith("event:")) continue;
          if (text === "[DONE]") break streamLoop;
          try {
            const event = JSON.parse(text) as Record<string, unknown>;
            if (mode === "anthropic") {
              if (event.type === "error") {
                throw new Error(upstreamErrorText(text) || "Anthropic 流式接口返回错误事件");
              }
              const delta = event.delta as Record<string, unknown> | undefined;
              // `thinking_delta` blocks share this event type and must not be
              // written into the chapter.
              if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
                content += delta.text; onChunk?.(delta.text);
              }
              const startUsage = event.type === "message_start" && event.message && typeof event.message === "object"
                ? (event.message as Record<string, unknown>).usage
                : undefined;
              usage = mergeUsage(usage, parseUsage(startUsage ?? event.usage));
              if (event.type === "message_stop") break streamLoop;
              continue;
            }
            const choice = Array.isArray(event.choices) ? event.choices[0] as Record<string, unknown> : undefined;
            const delta = choice?.delta as Record<string, unknown> | undefined;
            const chunk = typeof delta?.content === "string" ? delta.content : "";
            if (chunk) { content += chunk; onChunk?.(chunk); }
            usage = parseUsage(event.usage) || usage;
            // A number of OpenAI-compatible relays omit the terminal [DONE]
            // event but do provide choice.finish_reason. Stop as soon as the
            // model reports completion so the UI cannot remain stuck waiting
            // for another read from an otherwise open connection.
            if (typeof choice?.finish_reason === "string" && choice.finish_reason.trim()) break streamLoop;
          } catch (error) {
            // Ignore proxy keep-alives, but surface a real upstream error event.
            if (error instanceof Error && error.message.includes("Anthropic 流式接口")) throw error;
          }
        }
      }
    } catch (error) {
      if (!content) {
        const fallback = await this.chat(messages, options);
        onChunk?.(fallback.content);
        return fallback;
      }
      throw new Error(`API Saver 流式连接中断：${error instanceof Error ? error.message : String(error)}`);
    }
    recordRuntimeUsage(usage);
    // Some OpenAI-compatible gateways accept stream=true but answer with one
    // ordinary JSON response. Preserve compatibility and still update UI once.
    if (!content) {
      const fallback = await this.chat(messages, options);
      onChunk?.(fallback.content);
      return fallback;
    }
    return { content, model, usage };
  }
}
