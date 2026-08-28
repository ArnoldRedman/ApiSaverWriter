import type { Tiktoken, TiktokenEncoding } from 'js-tiktoken';

export type TokenMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const encodings = new Map<TiktokenEncoding, Tiktoken>();
const encodingName = (model: string): TiktokenEncoding => /^(?:gpt-4(?:-|$)|gpt-3\.5|gpt-35)/iu.test(model.trim()) ? 'cl100k_base' : 'o200k_base';

const tokenizer = async (model: string) => {
  const name = encodingName(model);
  const cached = encodings.get(name);
  if (cached) return cached;
  // tokenizer 数据约 5 MB，只在第一次模型请求时加载，不拖慢应用首页
  const { getEncoding } = await import('js-tiktoken');
  const created = getEncoding(name);
  encodings.set(name, created);
  return created;
};

export const countMessageTokens = async (messages: TokenMessage[], model: string) => {
  const encoding = await tokenizer(model);
  return messages.reduce((total, message) => total + encoding.encode(message.role).length + encoding.encode(message.content).length + 4, 2);
};

export const fitMessagesToTokenBudget = async (messages: TokenMessage[], budgetTokens: number, model: string): Promise<TokenMessage[]> => {
  const normalized = messages.map(message => ({ ...message, content: message.content.trim() })).filter(message => message.content);
  const encoding = await tokenizer(model);
  const count = (value: string) => encoding.encode(value).length;
  const total = normalized.reduce((sum, message) => sum + count(message.role) + count(message.content) + 4, 2);
  if (!budgetTokens || total <= budgetTokens) return normalized;

  const framing = normalized.reduce((sum, message) => sum + count(message.role) + 4, 2);
  let remaining = Math.max(0, budgetTokens - framing);
  const contents = new Array<string>(normalized.length).fill('');
  const priority = [
    ...normalized.map((message, index) => message.role === 'system' ? index : -1).filter(index => index >= 0),
    ...normalized.map((message, index) => message.role !== 'system' ? index : -1).filter(index => index >= 0).reverse(),
  ];
  for (const index of priority) {
    if (remaining <= 0) break;
    const content = normalized[index].content;
    const tokens = encoding.encode(content);
    contents[index] = tokens.length <= remaining ? content : encoding.decode(tokens.slice(0, remaining));
    remaining -= count(contents[index]);
  }
  return normalized.map((message, index) => ({ ...message, content: contents[index] })).filter(message => message.content);
};
