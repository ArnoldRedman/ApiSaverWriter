import { getEncoding, type Tiktoken, type TiktokenEncoding } from "js-tiktoken";

export interface TokenMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const encodings = new Map<TiktokenEncoding, Tiktoken>();

/**
 * OpenAI 兼容接口没有统一的模型元数据端点，按模型族选择其公开编码
 * 自定义的新模型默认使用 o200k_base，避免继续用字符数冒充 Token
 */
export function tokenizerEncodingForModel(model: string): TiktokenEncoding {
  const name = model.trim().toLowerCase();
  if (/^(?:gpt-5|gpt-4\.1|gpt-4o|chatgpt-4o|o[134](?:-|$))/u.test(name)) return "o200k_base";
  if (/^(?:gpt-4|gpt-3\.5|gpt-35)/u.test(name)) return "cl100k_base";
  return "o200k_base";
}

function tokenizer(model: string): Tiktoken {
  const name = tokenizerEncodingForModel(model);
  const cached = encodings.get(name);
  if (cached) return cached;
  const created = getEncoding(name);
  encodings.set(name, created);
  return created;
}

export function countTextTokens(value: string, model: string): number {
  return tokenizer(model).encode(value).length;
}

/** Chat Completions has a small framing cost around every message. */
export function countMessageTokens(messages: TokenMessage[], model: string): number {
  const encoding = tokenizer(model);
  return messages.reduce((total, message) => total + encoding.encode(message.role).length + encoding.encode(message.content).length + 4, 2);
}

function sliceTokens(value: string, maxTokens: number, model: string): string {
  if (maxTokens <= 0 || !value) return "";
  const encoding = tokenizer(model);
  const tokens = encoding.encode(value);
  if (tokens.length <= maxTokens) return value;
  if (maxTokens < 32) return encoding.decode(tokens.slice(0, maxTokens));
  const marker = "\n...[上下文已按 Token 预算截断]...\n";
  const markerTokens = encoding.encode(marker);
  if (markerTokens.length >= maxTokens) return encoding.decode(tokens.slice(0, maxTokens));
  const available = maxTokens - markerTokens.length;
  const head = Math.floor(available * 0.62);
  return `${encoding.decode(tokens.slice(0, head))}${marker}${encoding.decode(tokens.slice(tokens.length - (available - head)))}`;
}

/**
 * 在保持消息原顺序的同时优先保留 system 和最新轮次，最终结果不会超过 Token 预算
 */
export function fitMessagesToTokenBudget(messages: TokenMessage[], budgetTokens: number, model: string): TokenMessage[] {
  const normalized = messages.map(message => ({ ...message, content: message.content.trim() })).filter(message => message.content);
  if (!budgetTokens || countMessageTokens(normalized, model) <= budgetTokens) return normalized;

  const framing = normalized.reduce((total, message) => total + countTextTokens(message.role, model) + 4, 2);
  let remaining = Math.max(0, budgetTokens - framing);
  const contents = new Array<string>(normalized.length).fill("");
  const priority = [
    ...normalized.map((message, index) => message.role === "system" ? index : -1).filter(index => index >= 0),
    ...normalized.map((message, index) => message.role !== "system" ? index : -1).filter(index => index >= 0).reverse(),
  ];
  for (const index of priority) {
    if (remaining <= 0) break;
    const content = normalized[index].content;
    const size = countTextTokens(content, model);
    contents[index] = size <= remaining ? content : sliceTokens(content, remaining, model);
    remaining -= countTextTokens(contents[index], model);
  }
  return normalized.map((message, index) => ({ ...message, content: contents[index] })).filter(message => message.content);
}
