import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import SparkMD5 from 'spark-md5';

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
const baiduTokenKey = 'writer-baidu-access-token';
const baiduClientId = 'zF5kkNsCvckX4aIpRdHxpFkcSMxnGZky';
const baiduBackupName = 'ApiSaverWriter-backup.aswbackup';
const backupMagic = new TextEncoder().encode('ASWBACKUP\x01');

const emitCloudProgress = (message: string) => window.dispatchEvent(new CustomEvent('cloud-sync-progress', { detail: { message } }));

const mobileBaiduToken = () => stringValue(localStorage.getItem(baiduTokenKey)).trim();
const mobileBaiduURL = (base: string, params: Record<string, string>) => {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
};

const mobileBaiduRequest = async <T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> => {
  const fetcher = await httpFetch();
  const response = await fetcher(url, init);
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* Keep the response text for diagnostics. */ }
  const errno = Number(data.errno ?? data.error_code ?? 0);
  if (!response.ok || errno !== 0 || data.error) {
    const detail = stringValue(data.error_msg || data.error_description || data.error) || text.replace(/\s+/gu, ' ').slice(0, 220);
    throw new Error(`百度网盘请求失败（${response.status}${errno ? `/${errno}` : ''}）：${detail || '未知错误'}`);
  }
  return data as T;
};

const gzipBytes = async (bytes: Uint8Array) => {
  if (!('CompressionStream' in globalThis)) return bytes;
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
};

const gunzipBytes = async (bytes: Uint8Array) => {
  if (!bytes.slice(0, 2).every((value, index) => value === [0x1f, 0x8b][index])) return bytes;
  if (!('DecompressionStream' in globalThis)) throw new Error('当前 iOS 版本不支持解压百度网盘备份包，请升级系统。');
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
};

const u32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

const u64 = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
};

const concatBytes = (parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  parts.forEach(part => { output.set(part, offset); offset += part.byteLength; });
  return output;
};

const mobileBackupBundle = async (clientState: Record<string, string | null>) => {
  const encoder = new TextEncoder();
  const state = encoder.encode(JSON.stringify(clientState));
  const projects = encoder.encode(stringValue(clientState.projects, '[]'));
  const entries = [['client-state.json', state], ['projects.json', projects]] as Array<[string, Uint8Array]>;
  const parts: Uint8Array[] = [backupMagic, u64(entries.length)];
  entries.forEach(([path, content]) => {
    const pathBytes = encoder.encode(path);
    parts.push(u32(pathBytes.byteLength), u64(content.byteLength), pathBytes, content);
  });
  return gzipBytes(concatBytes(parts));
};

const readMobileBackupBundle = async (bytes: Uint8Array) => {
  const raw = await gunzipBytes(bytes);
  const decoder = new TextDecoder();
  let offset = backupMagic.byteLength;
  if (decoder.decode(raw.slice(0, offset)) !== decoder.decode(backupMagic)) throw new Error('云端文件不是有效的 ApiSaverWriter 完整备份包。');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const count = Number(view.getBigUint64(offset, true)); offset += 8;
  if (!Number.isSafeInteger(count) || count > 10000) throw new Error('云端备份包文件数量异常。');
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const pathLength = view.getUint32(offset, true); offset += 4;
    const size = Number(view.getBigUint64(offset, true)); offset += 8;
    const path = decoder.decode(raw.slice(offset, offset + pathLength)); offset += pathLength;
    if (!path || path.includes('..') || path.startsWith('/') || !Number.isSafeInteger(size) || size < 0 || offset + size > raw.byteLength) throw new Error('云端备份包包含不安全路径或无效内容。');
    files[path] = decoder.decode(raw.slice(offset, offset + size)); offset += size;
  }
  const state = JSON.parse(files['client-state.json'] || '{}') as Record<string, string | null>;
  return { clientState: state };
};

const mobileBaiduStatus = async () => {
  const token = mobileBaiduToken();
  if (!token) return { authenticated: false, logged_in: false, raw: '未登录' };
  try {
    const data = await mobileBaiduRequest<Record<string, unknown>>(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/nas', { method: 'uinfo', access_token: token }));
    return { ...data, authenticated: true, logged_in: true, username: stringValue(data.baidu_name || data.netdisk_name) };
  } catch (error) {
    localStorage.removeItem(baiduTokenKey);
    throw error;
  }
};

const mobileBaiduLoginURL = () => mobileBaiduURL('https://openapi.baidu.com/oauth/2.0/authorize', {
  client_id: baiduClientId, display: 'popup', qrcode: '1', redirect_uri: 'oob', response_type: 'token', scope: 'basic,netdisk',
});

const extractBaiduToken = (value: string) => {
  const raw = value.trim();
  try {
    const url = new URL(raw);
    return new URLSearchParams(url.hash.replace(/^#/u, '')).get('access_token')
      || url.searchParams.get('access_token')
      || '';
  } catch {
    const match = raw.match(/(?:access_token[=:])([A-Za-z0-9._-]+)/u);
    return match?.[1] || raw;
  }
};

const mobileBaiduCompleteLogin = async (value: string) => {
  const token = extractBaiduToken(value);
  if (token.length < 20) throw new Error('授权结果中没有找到有效 access_token，请粘贴浏览器地址栏完整内容或 access_token。');
  localStorage.setItem(baiduTokenKey, token);
  try { return await mobileBaiduStatus(); } catch (error) { localStorage.removeItem(baiduTokenKey); throw error; }
};

const mobileBaiduForm = (fields: Record<string, string>) => Object.entries(fields).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');

const mobileBaiduEnsureDirectory = async (remotePath: string) => {
  const segments = remotePath.split('/').filter(Boolean);
  let current = '/apps/bdpan';
  for (const segment of segments) {
    current += `/${segment}`;
    try {
      await mobileBaiduRequest(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'create', access_token: mobileBaiduToken() }), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: mobileBaiduForm({ path: current, isdir: '1', rtype: '1' }),
      });
    } catch (error) {
      if (!/已存在|exist|errno.?-8|\/-8/u.test(String(error))) throw error;
    }
  }
};

const mobileBaiduUpload = async (remotePath: string, bytes: Uint8Array) => {
  const chunkSize = 4 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) chunks.push(bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength)));
  const blockList = chunks.map(chunk => SparkMD5.ArrayBuffer.hash(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)));
  const path = `/apps/bdpan/${remotePath}/${baiduBackupName}`;
  const precreate = await mobileBaiduRequest<{ uploadid?: string; return_type?: number }>(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'precreate', access_token: mobileBaiduToken() }), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: mobileBaiduForm({ path, size: String(bytes.byteLength), isdir: '0', autoinit: '1', block_list: JSON.stringify(blockList), rtype: '3' }),
  });
  const uploadId = stringValue(precreate.uploadid);
  if (Number(precreate.return_type) !== 2 && !uploadId) throw new Error('百度网盘没有返回上传任务 ID。');
  if (Number(precreate.return_type) !== 2) {
    for (const [index, chunk] of chunks.entries()) {
      emitCloudProgress(`正在上传备份分片 ${index + 1}/${chunks.length}...`);
      const form = new FormData();
      form.append('file', new Blob([chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)]), baiduBackupName);
      await mobileBaiduRequest(mobileBaiduURL('https://d.pcs.baidu.com/rest/2.0/pcs/superfile2', { method: 'upload', type: 'tmpfile', access_token: mobileBaiduToken(), path, uploadid: uploadId, partseq: String(index) }), { method: 'POST', headers: { 'User-Agent': 'pan.baidu.com' }, body: form });
    }
    await mobileBaiduRequest(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'create', access_token: mobileBaiduToken() }), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: mobileBaiduForm({ path, size: String(bytes.byteLength), isdir: '0', uploadid: uploadId, block_list: JSON.stringify(blockList), rtype: '3' }),
    });
  }
  return path;
};

const mobileBaiduTimeout = async <T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => void) => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          onTimeout();
          reject(new Error('请求超时。'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};

const mobileBaiduDownloadBytes = async (fetcher: typeof globalThis.fetch, url: string, label: string) => {
  const controller = new AbortController();
  const request = fetcher(url, { headers: { 'User-Agent': 'pan.baidu.com' }, signal: controller.signal });
  let response: Response;
  try {
    response = await mobileBaiduTimeout(request, 30_000, () => controller.abort());
  } catch (error) {
    controller.abort();
    throw new Error(`${label}连接超时（30 秒）：${String(error)}`);
  }
  if (!response.ok) throw new Error(`${label}失败（${response.status}）。`);
  const expected = Number(response.headers.get('content-length')) || 0;
  emitCloudProgress(expected ? `${label}已连接，准备下载 ${(expected / 1_048_576).toFixed(1)} MB...` : `${label}已连接，正在下载...`);
  if (!response.body) {
    const bytes = await mobileBaiduTimeout(response.arrayBuffer(), 30_000, () => controller.abort());
    return new Uint8Array(bytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const result = await mobileBaiduTimeout(reader.read(), 30_000, () => {
      controller.abort();
      void reader.cancel();
    });
    if (result.done) break;
    if (result.value?.byteLength) {
      chunks.push(result.value);
      received += result.value.byteLength;
      emitCloudProgress(expected
        ? `${label} ${Math.min(100, Math.round(received * 100 / expected))}%（${(received / 1_048_576).toFixed(1)}/${(expected / 1_048_576).toFixed(1)} MB）`
        : `${label} 已下载 ${(received / 1_048_576).toFixed(1)} MB`);
    }
  }
  return concatBytes(chunks);
};

const mobileBaiduDownload = async (remotePath: string) => {
  const directory = `/apps/bdpan/${remotePath}`;
  const searchURL = mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'search', access_token: mobileBaiduToken(), dir: directory, key: baiduBackupName, recursion: '0', page: '1', num: '20', web: '1' });
  const fetcher = await httpFetch();
  const searchResponse = await fetcher(searchURL);
  const searchText = await searchResponse.text();
  if (!searchResponse.ok) throw new Error(`百度网盘搜索失败（${searchResponse.status}）`);
  const searchData = JSON.parse(searchText) as { errno?: number; error_msg?: string; list?: Array<{ path?: string; fs_id?: number | string }> };
  if (Number(searchData.errno || 0) !== 0) throw new Error(`百度网盘搜索失败：${searchData.error_msg || `errno ${searchData.errno}`}`);
  const match = searchData.list?.find(item => item.path === `${directory}/${baiduBackupName}`) || searchData.list?.[0];
  const fsId = match?.fs_id;
  if (!match || fsId === undefined || fsId === null) throw new Error('没有找到云端完整备份文件。');
  // filemetas expects a JSON array of numeric IDs. Keep the original decimal
  // string to avoid JavaScript precision loss for large Baidu fs_id values.
  const fsids = /^\d+$/u.test(String(fsId)) ? `[${String(fsId)}]` : JSON.stringify([String(fsId)]);
  const meta = await mobileBaiduRequest<{ list?: Array<{ dlink?: string }>}>(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/multimedia', { method: 'filemetas', access_token: mobileBaiduToken(), fsids, dlink: '1', extra: '1' }));
  const dlink = stringValue(meta.list?.[0]?.dlink);
  if (!dlink) throw new Error('百度网盘没有返回备份下载地址。');
  const dlinkURL = `${dlink}${dlink.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(mobileBaiduToken())}`;
  let bytes: Uint8Array;
  try {
    bytes = await mobileBaiduDownloadBytes(fetcher, dlinkURL, '百度网盘完整备份下载');
  } catch (primaryError) {
    emitCloudProgress('主下载地址无响应，正在切换备用下载通道...');
    const fallbackURL = mobileBaiduURL('https://d.pcs.baidu.com/rest/2.0/pcs/file', {
      method: 'download', access_token: mobileBaiduToken(), path: `${directory}/${baiduBackupName}`,
    });
    try {
      bytes = await mobileBaiduDownloadBytes(fetcher, fallbackURL, '百度网盘备用下载');
    } catch (fallbackError) {
      throw new Error(`百度网盘下载失败：${String(primaryError)}；备用通道：${String(fallbackError)}`);
    }
  }
  return readMobileBackupBundle(bytes);
};

const mobileBaiduBackup = async (remotePath: string, clientState: Record<string, string | null>) => {
  const status = await mobileBaiduStatus();
  if (!status.authenticated) throw new Error('请先登录百度网盘，再开始备份。');
  const path = remotePath.trim().replace(/^\/+|\/+$/gu, '');
  if (!path || path.includes('..')) throw new Error('云端路径无效，只能使用 /apps/bdpan/ 下的相对路径。');
  emitCloudProgress('正在整理完整应用备份...');
  const bundle = await mobileBackupBundle(clientState);
  await mobileBaiduEnsureDirectory(path);
  const remoteFile = await mobileBaiduUpload(path, bundle);
  emitCloudProgress('完整备份已上传到百度网盘。');
  return { remotePath: path, remoteFile, size: bundle.byteLength, scope: 'projects, books, dismantles, rankings, styles, client-state' };
};

const mobileBaiduRestore = async (remotePath: string) => {
  const status = await mobileBaiduStatus();
  if (!status.authenticated) throw new Error('请先登录百度网盘，再开始恢复。');
  const path = remotePath.trim().replace(/^\/+|\/+$/gu, '');
  if (!path || path.includes('..')) throw new Error('云端路径无效，只能使用 /apps/bdpan/ 下的相对路径。');
  const result = await mobileBaiduDownload(path);
  emitCloudProgress('完整备份已下载，正在恢复本机数据。');
  return result;
};
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
  if (command === 'cloud_sync_status') return mobileBaiduStatus() as T;
  if (command === 'baidu_login_url') return mobileBaiduLoginURL() as T;
  if (command === 'complete_baidu_login') {
    const input = args as { code?: string } | undefined;
    return mobileBaiduCompleteLogin(stringValue(input?.code)) as T;
  }
  if (command === 'backup_projects_to_baidu') {
    const input = args as { remotePath?: string; clientState?: Record<string, string | null> } | undefined;
    return mobileBaiduBackup(stringValue(input?.remotePath), input?.clientState || {}) as T;
  }
  if (command === 'restore_projects_from_baidu') {
    const input = args as { remotePath?: string } | undefined;
    return mobileBaiduRestore(stringValue(input?.remotePath)) as T;
  }
  if (command === 'call_agent_rpc') {
    const input = args as { method?: string; params?: MobileParams } | undefined;
    if (!input?.method) throw new Error('缺少 Agent RPC 方法。');
    return mobileAgentRpc<T>(input.method, input.params || {});
  }
  if (command === 'detect_system_proxy') return null as T;
  return nativeInvoke<T>(command, args);
};

export const isMobileRuntime = mobileRuntime;
