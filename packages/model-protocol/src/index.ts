export type ApiWireMode = 'openai' | 'anthropic';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export const anthropicVersion = '2023-06-01';
export const anthropicThinkingBudget: Readonly<Record<string, number>> = Object.freeze({ low: 2048, medium: 6144, high: 12288, max: 24576 });
export const openAIReasoningEffort: Readonly<Record<string, string>> = Object.freeze({ minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'high' });

export const normalizeWireMode = (value: unknown): ApiWireMode => String(value ?? '').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';

export const authHeaders = (key: string, mode: ApiWireMode): Record<string, string> => mode === 'anthropic'
  ? { 'x-api-key': key, 'anthropic-version': anthropicVersion }
  : { Authorization: `Bearer ${key}` };

/** Anthropic keeps system outside the turn list and requires a user first turn. */
export const toAnthropicMessages = (messages: ChatMessage[]) => {
  const system = messages.filter(message => message.role === 'system' && message.content.trim()).map(message => message.content).join('\n\n');
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    if (message.role === 'system' || !message.content.trim()) continue;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const previous = turns[turns.length - 1];
    if (previous?.role === role) previous.content = `${previous.content}\n\n${message.content}`;
    else turns.push({ role, content: message.content });
  }
  if (!turns.length) turns.push({ role: 'user', content: system || '继续' });
  if (turns[0].role === 'assistant') turns.unshift({ role: 'user', content: '请继续。' });
  return { system, turns };
};

const textFrom = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  return typeof item.text === 'string' ? item.text : typeof item.content === 'string' ? item.content : '';
};

/** Only text blocks are user-visible prose; thinking/tool blocks stay private. */
export const anthropicText = (value: unknown): string => Array.isArray(value)
  ? value.filter((block): block is Record<string, unknown> => Boolean(block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text')).map(block => typeof block.text === 'string' ? block.text : '').join('')
  : textFrom(value);
