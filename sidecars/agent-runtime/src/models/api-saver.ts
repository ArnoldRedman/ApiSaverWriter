import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ProxyAgent } from "undici";

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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function apiErrorMessage(status: number, detail: string, statusText: string, attempts: number, routeHint = ""): string {
  const retrySuffix = attempts > 1 ? `，已自动重试 ${attempts - 1} 次` : "";
  if ([502, 503, 504].includes(status)) {
    return `API 中转服务当前返回 ${status}（可能来自代理或 API 上游网关）${routeHint}${retrySuffix}，请稍后再试、测试模型，或在设置中切换模型。`;
  }
  if (status === 429) return `API 中转服务请求过于频繁${routeHint}${retrySuffix}，请稍后再试。`;
  if (status === 401 || status === 403) return `API Key 或模型权限校验失败（${status}）${routeHint}，请在设置中检查配置。`;

  const compact = detail.trim().startsWith("<")
    ? "服务返回了网页错误页面"
    : detail.trim().replace(/\s+/g, " ").slice(0, 240);
  return `API Saver 请求失败（${status}）${routeHint}：${compact || statusText || "未知错误"}`;
}

export function buildModelConfig(input: ApiSaverModelInput): ApiSaverModelConfig {
  const raw = trimTrailingSlash(input.baseUrl?.trim() || "https://api.apisaver.com");
  const baseUrl = input.provider === "openai"
    ? raw.endsWith("/v1") ? raw : `${raw}/v1`
    : raw.endsWith("/messages") ? raw : `${raw}/v1/messages`;
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
  apiMode?: "openai" | "responses" | "anthropic";
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

const proxyAgents = new Map<string, ProxyAgent>();

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
  const budget = Math.floor(Number(contextWindowKB || 0) * 1024);
  if (!budget || messages.reduce((sum, message) => sum + message.content.length, 0) <= budget) return messages;
  let remaining = budget;
  return messages.map(message => {
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

  async listModels(): Promise<string[]> {
    const rawBaseURL = trimTrailingSlash(this.config.baseURL || "https://api.apisaver.com/v1")
      .replace(/\/(?:chat\/completions|responses|messages)$/i, "");
    const baseURL = rawBaseURL.endsWith("/v1") ? rawBaseURL : `${rawBaseURL}/v1`;
    const endpoint = `${baseURL}/models`;
    const dispatcher = proxyDispatcherFor(endpoint, this.config);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json" },
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(apiErrorMessage(response.status, detail, response.statusText, 1, proxyRouteHint(endpoint, this.config)));
    }
    const payload = await response.json() as { data?: Array<{ id?: string } | string>; models?: Array<{ id?: string } | string> };
    return Array.from(new Set((payload.data ?? payload.models ?? [])
      .map(item => typeof item === "string" ? item : item.id)
      .filter((model): model is string => Boolean(model))));
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<{ content: string; model: string }> {
    const model = options.model || this.config.defaultModel || "gpt-4o-mini";
    const rawBaseURL = trimTrailingSlash(this.config.baseURL || "https://api.apisaver.com/v1")
      .replace(/\/(?:chat\/completions|responses|messages)$/i, "");
    const baseURL = rawBaseURL.endsWith("/v1") ? rawBaseURL : `${rawBaseURL}/v1`;
    const apiMode = this.config.apiMode || "openai";
    const contextMessages = limitMessagesToKB(messages, this.config.contextWindowKB);
    const apiKeys = Array.from(new Set([this.config.apiKey, ...(this.config.apiKeys || [])].map(key => key.trim()).filter(Boolean)));
    const maxTokens = options.max_tokens ?? 4000;
    const reasoningMode = this.config.reasoningMode;
    const reasoning = reasoningMode && !["auto", "off"].includes(reasoningMode)
      ? { effort: reasoningMode === "custom" ? "medium" : reasoningMode }
      : undefined;
    let endpoint = `${baseURL}/chat/completions`;
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    let body: string;

    if (apiMode === "responses") {
      endpoint = `${baseURL}/responses`;
      body = JSON.stringify({
        model,
        input: contextMessages.map(message => ({ role: message.role, content: message.content })),
        temperature: options.temperature ?? 0.7,
        max_output_tokens: maxTokens,
        text: options.response_format?.type === "json_object" ? { format: { type: "json_object" } } : undefined,
        reasoning,
      });
    } else if (apiMode === "anthropic") {
      endpoint = `${baseURL}/messages`;
      const system = contextMessages.filter(message => message.role === "system").map(message => message.content).join("\n\n");
      body = JSON.stringify({
        model,
        system: system || undefined,
        messages: contextMessages.filter(message => message.role !== "system").map(message => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content })),
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.7,
      });
        headers = {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      };
    } else {
      body = JSON.stringify({
        model,
        messages: contextMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: maxTokens,
        response_format: options.response_format,
        reasoning,
      });
    }
    const maxAttempts = Math.max(1, Math.min(5, options.retryAttempts ?? 3));
    let lastNetworkError = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const requestKey = apiKeys[(attempt - 1) % Math.max(1, apiKeys.length)] || this.config.apiKey;
        const requestHeaders = { ...headers };
        if (apiMode === "anthropic") requestHeaders["x-api-key"] = requestKey;
        else requestHeaders.Authorization = `Bearer ${requestKey}`;
        const dispatcher = proxyDispatcherFor(endpoint, this.config);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: requestHeaders,
          body,
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
        if (response.ok) {
          const data = await response.json() as Record<string, unknown>;
          const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
          const firstMessage = choices[0]?.message as Record<string, unknown> | undefined;
          const anthropicContent = Array.isArray(data.content) ? data.content as Array<Record<string, unknown>> : [];
          const outputItems = Array.isArray(data.output) ? data.output as Array<Record<string, unknown>> : [];
          const outputText = outputItems.flatMap(item => Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [])
            .map(item => typeof item.text === "string" ? item.text : "").filter(Boolean).join("\n");
          const content = apiMode === "anthropic"
            ? anthropicContent.map(item => typeof item.text === "string" ? item.text : "").filter(Boolean).join("\n")
            : apiMode === "responses"
              ? (typeof data.output_text === "string" ? data.output_text : outputText)
              : (typeof firstMessage?.content === "string" ? firstMessage.content : "");
          if (!content) throw new Error("API Saver 返回内容为空");
          return { content, model: typeof data.model === "string" ? data.model : model };
        }

        const detail = await response.text();
        const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        if (retryable && attempt < maxAttempts) {
          await sleep(800 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(apiErrorMessage(response.status, detail, response.statusText, attempt, proxyRouteHint(endpoint, this.config)));
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
}
