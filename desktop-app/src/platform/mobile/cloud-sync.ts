import { gzip, gunzip } from 'fflate';
import SparkMD5 from 'spark-md5';

type CloudBackupFile = {
  name: string;
  path: string;
  fsId?: string;
  size: number;
  modifiedAt: string;
  isBundle: boolean;
  source: 'bundle';
};

const stringValue = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
let httpFetchPromise: Promise<typeof globalThis.fetch> | null = null;
const httpFetch = async (): Promise<typeof globalThis.fetch> => {
  if (!httpFetchPromise) {
    httpFetchPromise = import('@tauri-apps/plugin-http')
      .then(module => module.fetch as unknown as typeof globalThis.fetch)
      .catch(() => globalThis.fetch.bind(globalThis));
  }
  return httpFetchPromise;
};

const baiduTokenKey = 'writer-baidu-access-token';
const baiduClientId = 'zF5kkNsCvckX4aIpRdHxpFkcSMxnGZky';
const baiduBackupName = 'Zhizhang-backup.zzbackup';
const backupMagic = new TextEncoder().encode('ZZBACKUP\x01');
/** 改名前写出的备份包标识，只用于读取 */
const legacyBackupMagic = new TextEncoder().encode('ASWBACKUP\x01');
/** 两种扩展名都要能恢复，否则改名当天用户手上的备份全部作废 */
const backupExtensions = ['.zzbackup', '.aswbackup'];
const hasBackupExtension = (name: string) => backupExtensions.some(extension => name.toLowerCase().endsWith(extension));

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

const gzipBytes = (bytes: Uint8Array) => new Promise<Uint8Array>((resolve, reject) => {
  gzip(bytes, { level: 9 }, (error, result) => error ? reject(error) : resolve(result));
});

const gunzipBytes = (bytes: Uint8Array) => {
  if (!bytes.slice(0, 2).every((value, index) => value === [0x1f, 0x8b][index])) return bytes;
  return new Promise<Uint8Array>((resolve, reject) => {
    gunzip(bytes, (error, result) => error ? reject(error) : resolve(result));
  });
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

const safeBackupRelativePath = (value: string) => {
  if (!value || value.startsWith('/') || value.includes('\0') || /^[A-Za-z]:[\\/]/u.test(value)) return false;
  const segments = value.replace(/\\/gu, '/').split('/');
  return segments.every(segment => Boolean(segment) && segment !== '.' && segment !== '..');
};

const mobileBundleSafeName = (value: unknown, fallback: string) => {
  const cleaned = String(value || '').trim().replace(/[\\/:*?"<>|]/gu, '_').replace(/^[. ]+|[. ]+$/gu, '').trim();
  return cleaned || fallback;
};

const mobileBundleJSON = <T>(files: Record<string, string>, path: string): T | null => {
  try { return files[path] ? JSON.parse(files[path]) as T : null; } catch { return null; }
};

const mobileBundlePath = (...parts: string[]) => parts.filter(Boolean).join('/');

// Desktop backups store large text fields as Markdown files and keep only an
// index in metadata.json. Rehydrate those indexes here because iOS does not
// have the desktop filesystem restore command.
const mobileHydrateDirectorySnapshots = (files: Record<string, string>) => {
  const projects: unknown[] = [];
  Object.keys(files).filter(path => /^projects\/[^/]+\/metadata\.json$/u.test(path)).forEach(metadataPath => {
    const projectFolder = metadataPath.split('/')[1];
    const project = mobileBundleJSON<Record<string, unknown>>(files, metadataPath);
    if (!project) return;
    const chapters = Array.isArray(project.chapters) ? project.chapters.map((chapter: Record<string, unknown>) => {
      const title = mobileBundleSafeName(chapter.title, '未命名章节');
      const contentPath = mobileBundlePath('projects', projectFolder, '章节', `${title}.md`);
      return { ...chapter, content: files[contentPath] ?? String(chapter.content || '') };
    }) : [];
    const outlines = Array.isArray(project.outlines) ? project.outlines.map((outline: Record<string, unknown>) => {
      const title = mobileBundleSafeName(outline.title || outline.kind, '大纲');
      const contentPath = mobileBundlePath('projects', projectFolder, '大纲', `${title}.md`);
      return { ...outline, content: files[contentPath] ?? String(outline.content || '') };
    }) : [];
    const cards = Array.isArray(project.cards) ? project.cards.map((card: Record<string, unknown>) => {
      const type = mobileBundleSafeName(card.type, '角色卡');
      const title = mobileBundleSafeName(card.title, '未命名卡片');
      const contentPath = mobileBundlePath('projects', projectFolder, '卡片', type, `${title}.md`);
      const markdown = files[contentPath];
      if (!markdown) return card;
      const [body, state] = markdown.split('\n## 当前状态\n');
      const currentState = state?.split('\n## 状态历史\n')[0]?.trim();
      return { ...card, content: body.trim(), currentState: currentState && currentState !== '暂无' ? currentState : card.currentState };
    }) : [];
    const memoryDocuments = Array.isArray(project.memoryDocuments) ? project.memoryDocuments.map((document: Record<string, unknown>) => {
      const title = mobileBundleSafeName(document.title || document.kind, '章节快照');
      const contentPath = mobileBundlePath('projects', projectFolder, '记忆', `${title}.md`);
      return { ...document, content: files[contentPath] ?? String(document.content || '') };
    }) : [];
    projects.push({ ...project, chapters, outlines, cards, memoryDocuments });
  });

  const hydrateExternalBooks = (prefix: 'books' | 'dismantles') => {
    const books: unknown[] = [];
    Object.keys(files).filter(path => new RegExp(`^${prefix}/[^/]+/metadata\\.json$`, 'u').test(path)).forEach(metadataPath => {
      const folder = metadataPath.split('/')[1];
      const book = mobileBundleJSON<Record<string, unknown>>(files, metadataPath);
      if (!book) return;
      const chapters = Array.isArray(book.chapters) ? book.chapters.map((chapter: Record<string, unknown>) => {
        const relative = typeof chapter.sourcePath === 'string' && chapter.sourcePath ? chapter.sourcePath : prefix === 'books'
          ? `章节/${mobileBundleSafeName(chapter.title, '未命名章节')}.md`
          : `原文/${String(chapter.number || 1).padStart(3, '0')}-${mobileBundleSafeName(chapter.title, '未命名章节')}.txt`;
        const content = files[mobileBundlePath(prefix, folder, relative)];
        if (prefix === 'books') return { ...chapter, content: content ?? String(chapter.content || ''), downloaded: content ? true : chapter.downloaded };
        return { ...chapter, sourceContent: content ?? String(chapter.sourceContent || '') };
      }) : [];
      books.push({ ...book, chapters });
    });
    return books;
  };

  return {
    projects,
    libraryBooks: hydrateExternalBooks('books'),
    dismantleBooks: hydrateExternalBooks('dismantles'),
    rankingBooks: mobileBundleJSON<unknown[]>(files, 'rankings/metadata.json') || [],
    writingStyles: (() => {
      const styles = mobileBundleJSON<Record<string, unknown>[]>(files, 'styles/metadata.json') || [];
      return styles.map(style => {
        const sourcePath = typeof style.sourcePath === 'string' ? style.sourcePath : `${mobileBundleSafeName(style.name, '未命名文风')}.md`;
        return { ...style, content: files[mobileBundlePath('styles', sourcePath)] ?? String(style.content || '') };
      });
    })(),
  };
};

const mobileBackupBundle = async (clientState: Record<string, string | null>) => {
  const encoder = new TextEncoder();
  const state = encoder.encode(JSON.stringify(clientState));
  const snapshotFiles: Array<[string, string]> = [
    ['projects.json', 'projects'],
    ['library-books.json', 'writer-library-books'],
    ['ranking-books.json', 'writer-ranking-books'],
    ['dismantle-books.json', 'writer-dismantle-books'],
    ['writing-styles.json', 'writer-writing-styles'],
    ['agent-config.json', 'agent-config'],
    ['writer-skills.json', 'writer-skills'],
    ['backup-manifest.json', 'backup-manifest'],
    ['agent-chats.json', 'agent-chats'],
  ];
  const entries = [['client-state.json', state], ...snapshotFiles.map(([file, key]) => [file, encoder.encode(stringValue(clientState[key], key === 'agent-config' || key === 'backup-manifest' || key === 'agent-chats' ? '{}' : '[]'))] as [string, Uint8Array])] as Array<[string, Uint8Array]>;
  const parts: Uint8Array[] = [backupMagic, u64(entries.length)];
  entries.forEach(([path, content]) => {
    const pathBytes = encoder.encode(path);
    parts.push(u32(pathBytes.byteLength), u64(content.byteLength), pathBytes, content);
  });
  return gzipBytes(concatBytes(parts));
};

const readMobileBackupBundle = async (bytes: Uint8Array) => {
  emitCloudProgress(`下载完成（${(bytes.byteLength / 1_048_576).toFixed(1)} MB），正在解压完整备份...`);
  const raw = await gunzipBytes(bytes);
  emitCloudProgress(`解压完成（${(raw.byteLength / 1_048_576).toFixed(1)} MB），正在校验备份内容...`);
  const decoder = new TextDecoder();
  let offset = backupMagic.byteLength;
  const header = decoder.decode(raw.slice(0, offset));
  if (header !== decoder.decode(backupMagic) && header !== decoder.decode(legacyBackupMagic)) {
    throw new Error('云端文件不是有效的织章完整备份包。');
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const count = Number(view.getBigUint64(offset, true)); offset += 8;
  if (!Number.isSafeInteger(count) || count > 10000) throw new Error('云端备份包文件数量异常。');
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    if (offset + 12 > raw.byteLength) throw new Error(`云端备份包索引不完整（文件 ${index + 1}/${count}）。`);
    const pathLength = view.getUint32(offset, true); offset += 4;
    const size = Number(view.getBigUint64(offset, true)); offset += 8;
    if (!pathLength || offset + pathLength > raw.byteLength) throw new Error(`云端备份包路径索引无效（文件 ${index + 1}/${count}）。`);
    const path = decoder.decode(raw.slice(offset, offset + pathLength)); offset += pathLength;
    if (!safeBackupRelativePath(path)) throw new Error(`云端备份包包含不安全路径：${path}`);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > raw.byteLength) throw new Error(`云端备份包文件内容不完整：${path}`);
    files[path] = decoder.decode(raw.slice(offset, offset + size)); offset += size;
    if (count > 1) emitCloudProgress(`正在解析备份文件 ${index + 1}/${count}...`);
  }
  emitCloudProgress('备份包校验通过，正在读取应用数据...');
  const parsedState = JSON.parse(files['client-state.json'] || '{}') as unknown;
  if (!parsedState || typeof parsedState !== 'object' || Array.isArray(parsedState)) throw new Error('备份包中的应用状态格式无效。');
  const state = parsedState as Record<string, string | null>;
  const snapshotFiles: Array<[string, string]> = [
    ['projects.json', 'projects'],
    ['library-books.json', 'writer-library-books'],
    ['ranking-books.json', 'writer-ranking-books'],
    ['dismantle-books.json', 'writer-dismantle-books'],
    ['writing-styles.json', 'writer-writing-styles'],
    ['agent-config.json', 'agent-config'],
    ['writer-skills.json', 'writer-skills'],
    ['backup-manifest.json', 'backup-manifest'],
    ['agent-chats.json', 'agent-chats'],
  ];
  snapshotFiles.forEach(([file, key]) => {
    if (typeof state[key] !== 'string' && typeof files[file] === 'string') state[key] = files[file];
  });
  const directorySnapshots = mobileHydrateDirectorySnapshots(files);
  if (directorySnapshots.projects.length) state.projects = JSON.stringify(directorySnapshots.projects);
  if (directorySnapshots.libraryBooks.length) state['writer-library-books'] = JSON.stringify(directorySnapshots.libraryBooks);
  if (directorySnapshots.dismantleBooks.length) state['writer-dismantle-books'] = JSON.stringify(directorySnapshots.dismantleBooks);
  if (directorySnapshots.rankingBooks.length) state['writer-ranking-books'] = JSON.stringify(directorySnapshots.rankingBooks);
  if (directorySnapshots.writingStyles.length) state['writer-writing-styles'] = JSON.stringify(directorySnapshots.writingStyles);
  emitCloudProgress('应用数据读取完成，正在写入本机存储...');
  return { clientState: state };
};

const mobileBaiduStatus = async () => {
  const token = mobileBaiduToken();
  if (!token) return { authenticated: false, logged_in: false, raw: '未登录' };
  try {
    const data = await mobileBaiduRequest<Record<string, unknown>>(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/nas', { method: 'uinfo', openapi: 'xpansdk', access_token: token }));
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

const mobileCloudDirectory = (remotePath: string) => {
  const path = remotePath.trim().replace(/^\/+|\/+$/gu, '');
  if (!path || path.includes('..') || path.includes('\0') || path.includes('\\') || path.startsWith('.') || path.startsWith('~') || /^[A-Za-z]:/u.test(path)) {
    throw new Error('云端路径无效，只能使用 /apps/bdpan/ 下的相对路径。');
  }
  return { path, directory: `/apps/bdpan/${path}` };
};

const mobileCloudBackupPath = (remotePath: string, backupPath: string) => {
  const { path, directory } = mobileCloudDirectory(remotePath);
  const normalized = backupPath.trim().replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
  const relative = normalized.startsWith('apps/bdpan/') ? normalized.slice('apps/bdpan/'.length) : normalized;
  if (!relative || relative.includes('..') || !hasBackupExtension(relative)) {
    throw new Error('所选云端文件不是有效的织章备份包。');
  }
  const expectedPrefix = `${path}/`;
  if (!relative.startsWith(expectedPrefix) || relative.slice(expectedPrefix.length).includes('/')) {
    throw new Error('所选备份文件不在当前云端备份目录中。');
  }
  return { relative, fullPath: `${directory}/${relative.slice(expectedPrefix.length)}` };
};

const mobileBaiduEnsureDirectory = async (remotePath: string) => {
  const segments = remotePath.split('/').filter(Boolean);
  let current = '/apps/bdpan';
  for (const segment of segments) {
    current += `/${segment}`;
    try {
      await mobileBaiduRequest(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'create', openapi: 'xpansdk', access_token: mobileBaiduToken() }), {
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
  const blockList = chunks.map(chunk => SparkMD5.ArrayBuffer.hash(Uint8Array.from(chunk).buffer));
  const path = `/apps/bdpan/${remotePath}/${baiduBackupName}`;
  const precreate = await mobileBaiduRequest<{ uploadid?: string; return_type?: number }>(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'precreate', openapi: 'xpansdk', access_token: mobileBaiduToken() }), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: mobileBaiduForm({ path, size: String(bytes.byteLength), isdir: '0', autoinit: '1', block_list: JSON.stringify(blockList), rtype: '3' }),
  });
  const uploadId = stringValue(precreate.uploadid);
  if (Number(precreate.return_type) !== 2 && !uploadId) throw new Error('百度网盘没有返回上传任务 ID。');
  if (Number(precreate.return_type) !== 2) {
    for (const [index, chunk] of chunks.entries()) {
      emitCloudProgress(`正在上传备份分片 ${index + 1}/${chunks.length}...`);
      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(chunk).buffer]), baiduBackupName);
      await mobileBaiduRequest(mobileBaiduURL('https://d.pcs.baidu.com/rest/2.0/pcs/superfile2', { method: 'upload', openapi: 'xpansdk', type: 'tmpfile', access_token: mobileBaiduToken(), path, uploadid: uploadId, partseq: String(index) }), { method: 'POST', headers: { 'User-Agent': 'pan.baidu.com' }, body: form });
    }
    await mobileBaiduRequest(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', { method: 'create', openapi: 'xpansdk', access_token: mobileBaiduToken() }), {
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

const mobileBaiduListBackups = async (remotePath: string): Promise<{ files: CloudBackupFile[] }> => {
  const status = await mobileBaiduStatus();
  if (!status.authenticated) throw new Error('请先登录百度网盘，再查看云端备份。');
  const { path, directory } = mobileCloudDirectory(remotePath);
  const listURL = mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/file', {
    method: 'list', openapi: 'xpansdk', access_token: mobileBaiduToken(), dir: directory,
    order: 'time', desc: '1', start: '0', limit: '1000', web: '1',
  });
  const fetcher = await httpFetch();
  const response = await fetcher(listURL);
  const responseText = await response.text();
  if (!response.ok) throw new Error(`百度网盘备份列表加载失败（${response.status}）`);
  const data = JSON.parse(responseText) as {
    errno?: number;
    error_msg?: string;
    list?: Array<{ path?: string; server_filename?: string; fs_id?: number | string; size?: number; isdir?: number | boolean; server_mtime?: number | string; local_mtime?: number | string }>;
  };
  if (Number(data.errno || 0) !== 0) throw new Error(`百度网盘备份列表加载失败：${data.error_msg || `errno ${data.errno}`}`);
  const files = (data.list || []).flatMap((item): CloudBackupFile[] => {
    const name = stringValue(item.server_filename) || stringValue(item.path).split('/').pop() || '';
    const itemPath = stringValue(item.path);
    if (!hasBackupExtension(name) || Boolean(item.isdir) || !itemPath.startsWith(`${directory}/`)) return [];
    const rawTime = item.server_mtime ?? item.local_mtime;
    const numericTime = Number(rawTime);
    const modifiedAt = typeof rawTime === 'string' && /[T:-]/u.test(rawTime)
      ? rawTime
      : numericTime > 0 ? new Date(numericTime * 1000).toISOString() : '';
    return [{
      name,
      path: `${path}/${name}`,
      fsId: item.fs_id === undefined || item.fs_id === null ? undefined : String(item.fs_id),
      size: Number(item.size) || 0,
      modifiedAt,
      isBundle: true,
      source: 'bundle',
    }];
  }).sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { files };
};

const mobileBaiduDownload = async (remotePath: string, backupPath: string, backupFsId?: string) => {
  const selected = mobileCloudBackupPath(remotePath, backupPath);
  let fsId = backupFsId?.trim();
  if (!fsId) {
    const listed = await mobileBaiduListBackups(remotePath);
    fsId = listed.files.find(file => file.path === selected.relative)?.fsId;
  }
  if (!fsId) throw new Error('所选备份文件已不存在，请刷新备份列表后重试。');
  // filemetas expects a JSON array of numeric IDs. Keep the original decimal
  // string to avoid JavaScript precision loss for large Baidu fs_id values.
  const fsids = /^\d+$/u.test(String(fsId)) ? `[${String(fsId)}]` : JSON.stringify([String(fsId)]);
  const meta = await mobileBaiduRequest<{ list?: Array<{ dlink?: string }>}>(mobileBaiduURL('https://pan.baidu.com/rest/2.0/xpan/multimedia', { method: 'filemetas', openapi: 'xpansdk', access_token: mobileBaiduToken(), fsids, dlink: '1', extra: '1' }));
  const dlink = stringValue(meta.list?.[0]?.dlink);
  if (!dlink) throw new Error('百度网盘没有返回备份下载地址。');
  const fetcher = await httpFetch();
  const dlinkURL = `${dlink}${dlink.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(mobileBaiduToken())}`;
  let bytes: Uint8Array;
  try {
    bytes = await mobileBaiduDownloadBytes(fetcher, dlinkURL, '百度网盘完整备份下载');
  } catch (primaryError) {
    emitCloudProgress('主下载地址无响应，正在切换备用下载通道...');
    const fallbackURL = mobileBaiduURL('https://d.pcs.baidu.com/rest/2.0/pcs/file', {
      method: 'download', openapi: 'xpansdk', access_token: mobileBaiduToken(), path: selected.fullPath,
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
  return { remotePath: path, remoteFile, size: bundle.byteLength, scope: 'projects, books, dismantles, rankings, styles, agent-chats, client-state' };
};

const mobileBaiduRestore = async (remotePath: string, backupPath: string, backupFsId?: string) => {
  const status = await mobileBaiduStatus();
  if (!status.authenticated) throw new Error('请先登录百度网盘，再开始恢复。');
  const { path } = mobileCloudDirectory(remotePath);
  if (!backupPath.trim()) throw new Error('请先选择要恢复的云端备份文件。');
  const result = await mobileBaiduDownload(path, backupPath, backupFsId);
  emitCloudProgress('完整备份已下载，正在恢复本机数据。');
  return result;
};

export {
  mobileBaiduStatus,
  mobileBaiduLoginURL,
  mobileBaiduCompleteLogin,
  mobileBaiduBackup,
  mobileBaiduListBackups,
  mobileBaiduRestore,
};
