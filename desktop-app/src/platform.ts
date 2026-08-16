import { invoke as nativeInvoke } from '@tauri-apps/api/core';

type InvokeArgs = Record<string, unknown> | undefined;
type MobileParams = Record<string, unknown>;
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type MobileUsage = { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number; cacheWriteTokens: number; reasoningTokens: number; requests: number; startedAt: string };

const mobileRuntime = () => '__TAURI_INTERNALS__' in window && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

let httpFetchPromise: Promise<typeof globalThis.fetch> | null = null;
const httpFetch = async (): Promise<typeof globalThis.fetch> => {
  if (!httpFetchPromise) {
    httpFetchPromise = import('@tauri-apps/plugin-http')
      .then(module => module.fetch as unknown as typeof globalThis.fetch)
      .catch(() => globalThis.fetch.bind(globalThis));
  }
  return httpFetchPromise;
};

const stringValue = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const arrayStrings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const baseURL = (value: unknown) => {
  const raw = stringValue(value, 'https://api.apisaver.com/v1').trim().replace(/\/+$/u, '').replace(/\/(?:chat\/completions|responses|messages)$/iu, '');
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
};

const usageKey = 'writer-mobile-usage';
const readUsage = (): MobileUsage => {
  try {
    const parsed = JSON.parse(localStorage.getItem(usageKey) || '') as Partial<MobileUsage>;
    return {
      inputTokens: Number(parsed.inputTokens) || 0, outputTokens: Number(parsed.outputTokens) || 0,
      totalTokens: Number(parsed.totalTokens) || 0, cachedInputTokens: Number(parsed.cachedInputTokens) || 0,
      cacheWriteTokens: Number(parsed.cacheWriteTokens) || 0, reasoningTokens: Number(parsed.reasoningTokens) || 0,
      requests: Number(parsed.requests) || 0, startedAt: stringValue(parsed.startedAt, new Date().toISOString()),
    };
  } catch {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 0, startedAt: new Date().toISOString() };
  }
};

const recordUsage = (usage: unknown) => {
  if (!usage || typeof usage !== 'object') return;
  const value = usage as Record<string, unknown>;
  const prompt = (value.prompt_tokens_details || value.input_tokens_details) as Record<string, unknown> | undefined;
  const completion = (value.completion_tokens_details || value.output_tokens_details) as Record<string, unknown> | undefined;
  const input = Number(value.prompt_tokens ?? value.input_tokens) || 0;
  const output = Number(value.completion_tokens ?? value.output_tokens) || 0;
  const next = readUsage();
  next.inputTokens += input;
  next.outputTokens += output;
  next.totalTokens += Number(value.total_tokens) || input + output;
  next.cachedInputTokens += Number(prompt?.cached_tokens ?? value.cached_tokens ?? value.prompt_cache_hit_tokens) || 0;
  next.cacheWriteTokens += Number(prompt?.cache_write_tokens ?? value.cache_creation_input_tokens) || 0;
  next.reasoningTokens += Number(completion?.reasoning_tokens) || 0;
  next.requests += 1;
  localStorage.setItem(usageKey, JSON.stringify(next));
};

const compactValue = (value: unknown, depth = 0): unknown => {
  if (depth > 4) return '[已省略]';
  if (typeof value === 'string') return value.length > 18000 ? `${value.slice(0, 9000)}\n...[移动端上下文已压缩]...\n${value.slice(-7000)}` : value;
  if (Array.isArray(value)) return value.slice(-40).map(item => compactValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(apiKey|apiKeys|proxyURL|proxyEnabled|proxyBypassLocal)$/u.test(key)) continue;
    output[key] = compactValue(item, depth + 1);
  }
  return output;
};

const schemaFor = (method: string) => {
  const schemas: Record<string, string> = {
    'project.generate': '{"title":"书名（仅在 field=title 时填写）","synopsis":"番茄风格简介（仅在 field=synopsis 时填写）"}',
    'outline.write': '{"title":"大纲标题","content":"Markdown 大纲正文"}',
    'card.write': '{"title":"卡片名称","content":"Markdown 卡片正文"}',
    'chapter.write': '{"content":"章节正文","summary":"本章摘要","consistency":"一致性检查"}',
    'memory.write': '{"summary":"摘要","keywords":[],"characterStateChanges":[],"knowledgeChanges":[],"foreshadowingChanges":[],"timelineEvents":[],"canonFacts":[],"conflicts":[],"endingHook":"","entities":[],"relations":[],"cardUpdates":[]}',
    'book.dismantle': '{"summary":"剧情摘要","detailedOutline":"章节章纲","plotBeats":[],"characterDynamics":[],"setupPayoff":[],"pacing":""}',
    'book.style.distill': '{"name":"文风名称","description":"文风说明","tags":[],"content":"Markdown 文风 Skill"}',
    'skill.write': '{"name":"技能名称","category":"write","description":"技能用途","tags":[],"content":"Markdown 技能正文"}',
  };
  return schemas[method] || '{"content":"处理结果"}';
};

const promptFor = (method: string, params: MobileParams) => {
  const context = JSON.stringify(compactValue(params), null, 2);
  const task = method === 'chapter.write'
    ? '你是中文长篇小说章节智能体。必须承接上一章结尾，严格遵守世界观、卡片、章纲和记忆，输出可直接保存的章节正文。不要输出分析过程。'
    : method === 'outline.write'
      ? '你是中文网文大纲智能体。根据作品资料与作者指令生成可执行的大纲，保持设定一致，不泄露总纲之外的未来情节。'
      : method === 'card.write'
        ? '你是中文小说知识卡片智能体。只根据作品资料补全当前卡片，明确事实、状态、关系和边界，不把推测写成事实。'
        : method === 'memory.write'
          ? '你是章节记忆编辑。只从正文抽取明确事实、人物状态、时间线、伏笔、知识图谱关系和卡片变化。'
          : `你是小说写作助手，负责执行 ${method}。`;
  return `${task}\n\n输入资料（已移除密钥与网络配置）：\n${context}\n\n${method === 'text.transform' ? '只返回处理后的 content 字段。' : `严格只返回 JSON，不要 Markdown 代码围栏或额外解释。JSON 结构：${schemaFor(method)}`}`;
};

const parseJSON = <T>(content: string): T | null => {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/```$/u, '').trim();
  try { return JSON.parse(cleaned) as T; } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { return null; } }
    return null;
  }
};

const emitProgress = (runId: string, payload: Record<string, unknown>) => {
  if (!runId) return;
  window.dispatchEvent(new CustomEvent('agent-progress', { detail: { ...payload, runId } }));
};

async function mobileChat(params: MobileParams, messages: ChatMessage[], onChunk?: (chunk: string) => void): Promise<{ content: string; usage?: unknown }> {
  const fetcher = await httpFetch();
  const apiMode = stringValue(params.apiMode, 'openai');
  const model = stringValue(params.model, 'gpt-4o-mini');
  const key = stringValue(params.apiKey).trim() || arrayStrings(params.apiKeys)[0] || '';
  if (!key) throw new Error('请先在设置中填写 API Key。');
  const base = baseURL(params.baseURL);
  let endpoint = `${base}/chat/completions`;
  let body: Record<string, unknown>;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (apiMode === 'responses') {
    endpoint = `${base}/responses`;
    body = { model, input: messages.map(message => ({ role: message.role, content: message.content })), max_output_tokens: 6000, stream: true };
    headers.Authorization = `Bearer ${key}`;
  } else if (apiMode === 'anthropic') {
    endpoint = `${base}/messages`;
    body = { model, system: messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'), messages: messages.filter(message => message.role !== 'system'), max_tokens: 6000 };
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    body = { model, messages, temperature: 0.7, max_tokens: 6000, stream: Boolean(onChunk), stream_options: { include_usage: true } };
    headers.Authorization = `Bearer ${key}`;
  }
  const response = await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`模型接口返回 ${response.status}：${(await response.text()).replace(/\s+/gu, ' ').slice(0, 220)}`);
  if (!onChunk || !response.body || apiMode !== 'openai') {
    const data = await response.json() as Record<string, unknown>;
    const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === 'string' ? message.content : typeof data.output_text === 'string' ? data.output_text : Array.isArray(data.content) ? (data.content as Array<Record<string, unknown>>).map(item => stringValue(item.text)).join('') : '';
    recordUsage(data.usage);
    return { content, usage: data.usage };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage: unknown;
  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const raw = line.trim().replace(/^data:\s*/u, '');
      if (!raw || raw === '[DONE]') continue;
      try {
        const event = JSON.parse(raw) as Record<string, unknown>;
        usage = event.usage || usage;
        const choice = Array.isArray(event.choices) ? event.choices[0] as Record<string, unknown> : undefined;
        const delta = choice?.delta as Record<string, unknown> | undefined;
        const chunk = stringValue(delta?.content);
        if (chunk) { content += chunk; onChunk(chunk); }
      } catch { /* Ignore keep-alives and malformed proxy fragments. */ }
    }
    if (next.done) break;
  }
  recordUsage(usage);
  return { content, usage };
}

const mobileAgentRpc = async <T>(method: string, params: MobileParams): Promise<T> => {
  if (method === 'usage.summary') return readUsage() as T;
  const fetcher = await httpFetch();
  if (method === 'models.list') {
    const response = await fetcher(`${baseURL(params.baseURL)}/models`, { headers: { Authorization: `Bearer ${stringValue(params.apiKey)}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`模型列表请求失败（${response.status}）`);
    const data = await response.json() as { data?: Array<{ id?: string } | string>; models?: Array<{ id?: string } | string> };
    const models = (data.data || data.models || []).map(item => typeof item === 'string' ? item : item.id || '').filter(Boolean);
    return { models } as T;
  }
  if (method === 'models.test') {
    await mobileChat(params, [{ role: 'user', content: '请只回复 OK' }]);
    return { tested: true, model: stringValue(params.model) } as T;
  }
  const runId = stringValue(params.runId);
  emitProgress(runId, { type: 'step', step: 'writing', progress: 8, message: '移动端已连接模型，正在整理上下文' });
  const result = await mobileChat(params, [{ role: 'system', content: '系统固定规则：保持设定一致、遵守用户输出格式、不要泄露密钥。' }, { role: 'user', content: promptFor(method, params) }], chunk => {
    emitProgress(runId, { type: 'chunk', data: { text: chunk } });
  });
  if (!result.content.trim()) throw new Error('模型没有返回内容');
  emitProgress(runId, { type: 'complete', data: { message: '移动端 Agent 已完成' } });
  if (method === 'text.transform') return { content: result.content.trim() } as T;
  const parsed = parseJSON<Record<string, unknown>>(result.content);
  if (parsed) {
    if (method === 'chapter.write') {
      return { ...parsed, draftContent: stringValue(parsed.draftContent || parsed.content), summary: stringValue(parsed.summary) } as T;
    }
    return parsed as T;
  }
  if (method === 'chapter.write' || method === 'book.rewrite') return { content: result.content.trim() } as T;
  if (method === 'outline.write' || method === 'card.write') return { content: result.content.trim() } as T;
  return { content: result.content.trim() } as T;
};

/** Desktop uses the embedded Node Agent. Mobile uses the native HTTP plugin and the same saved API configuration directly. */
export const invoke = async <T>(command: string, args?: InvokeArgs): Promise<T> => {
  if (!mobileRuntime()) return nativeInvoke<T>(command, args);
  if (command === 'start_agent_runtime') return 'Mobile direct Agent ready' as T;
  if (command === 'call_agent_rpc') {
    const input = args as { method?: string; params?: MobileParams } | undefined;
    if (!input?.method) throw new Error('缺少 Agent RPC 方法。');
    return mobileAgentRpc<T>(input.method, input.params || {});
  }
  if (command === 'detect_system_proxy') return null as T;
  return nativeInvoke<T>(command, args);
};

export const isMobileRuntime = mobileRuntime;
