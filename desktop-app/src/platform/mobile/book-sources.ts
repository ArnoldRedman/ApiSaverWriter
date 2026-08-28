import qianyueSourceData from '../../data/qianyue-novel-sources.json';

type MobileParams = Record<string, unknown>;
type MobileQianyueSource = {
  bookSourceName?: string;
  bookSourceUrl?: string;
  searchUrl?: string;
  enabled?: boolean;
  ruleSearch?: Record<string, unknown>;
  ruleBookInfo?: Record<string, unknown>;
  ruleToc?: Record<string, unknown>;
  ruleContent?: Record<string, unknown>;
  header?: string;
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

const mobileResolveURL = (base: string, value: string) => {
  try { return value ? new URL(value, base).toString() : ''; } catch { return ''; }
};

const mobileFetchHTML = async (url: string, encoding = 'utf-8', init: RequestInit = {}) => {
  const fetcher = await httpFetch();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8_000);
  const initialHeaders = {
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    ...(init.headers as Record<string, string> || {}),
  };
  const withoutAuthorization = Object.fromEntries(Object.entries(initialHeaders).filter(([key]) => key.toLowerCase() !== 'authorization'));
  try {
    const execute = (headers: Record<string, string>) => fetcher(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    let response = await execute(initialHeaders);
    if ((response.status === 401 || response.status === 403) && Object.keys(initialHeaders).some(key => key.toLowerCase() === 'authorization')) {
      response = await execute(withoutAuthorization);
    }
    if (!response.ok) throw new Error(`书源返回 HTTP ${response.status}`);
    return new TextDecoder(encoding).decode(await response.arrayBuffer());
  } finally {
    window.clearTimeout(timer);
  }
};

const mobileChineseNumber = (value: string) => {
  const match = value.replace(/,/gu, '').match(/([\d.]+)\s*(万|亿)?/u);
  if (!match) return undefined;
  const multiplier = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  const number = Number(match[1]) * multiplier;
  return Number.isFinite(number) ? Math.round(number) : undefined;
};

const mobileNovelCatchCategories = async () => {
  const sections = [
    { key: 'male-read', label: '男频阅读', gender: 'm', list: 'read' },
    { key: 'male-new', label: '男频新书', gender: 'm', list: 'new' },
    { key: 'female-read', label: '女频阅读', gender: 'f', list: 'read' },
    { key: 'female-new', label: '女频新书', gender: 'f', list: 'new' },
  ];
  const result = await Promise.all(sections.map(async section => {
    const url = `https://novelcatch.com/rank?gender=${section.gender}&list=${section.list}`;
    const document = new DOMParser().parseFromString(await mobileFetchHTML(url), 'text/html');
    const seen = new Set<string>();
    const categories = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/rank?"]')).flatMap(link => {
      const target = mobileResolveURL(url, link.getAttribute('href') || '');
      if (!target || seen.has(target)) return [];
      const parsed = new URL(target);
      const category = parsed.searchParams.get('category');
      if (!category || parsed.searchParams.get('gender') !== section.gender || parsed.searchParams.get('list') !== section.list) return [];
      seen.add(target);
      return [{ id: category, label: link.textContent?.trim() || category, url: target, gender: section.gender === 'f' ? 'female' : 'male', list: section.list }];
    });
    return { key: section.key, label: section.label, url, categories };
  }));
  return { sections: result };
};

const mobileRankingFetch = async (params: MobileParams) => {
  const platform = stringValue(params.platform, 'fanqie');
  const rankType = stringValue(params.rankType, 'read');
  const gender = stringValue(params.gender, 'male');
  if (platform === 'fanqie') {
    const url = /^https:\/\/novelcatch\.com\/rank\?/u.test(stringValue(params.rankUrl))
      ? stringValue(params.rankUrl)
      : `https://novelcatch.com/rank?gender=${gender === 'female' ? 'f' : 'm'}&list=${rankType === 'new' ? 'new' : 'read'}&category=all`;
    const document = new DOMParser().parseFromString(await mobileFetchHTML(url), 'text/html');
    const seen = new Set<string>();
    const books = Array.from(document.querySelectorAll<HTMLElement>('div.border-b.border-line')).flatMap((card, index) => {
      const titleLink = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href^="/book/"]')).find(link => link.textContent?.trim());
      const href = titleLink?.getAttribute('href') || '';
      const bookId = href.match(/\/(\d+)$/u)?.[1] || '';
      const title = titleLink?.textContent?.trim() || '';
      if (!bookId || !title || seen.has(bookId)) return [];
      seen.add(bookId);
      const info = card.querySelector<HTMLElement>('.mt-1.flex.flex-wrap.items-center')?.textContent?.replace(/\s+/gu, ' ').trim() || '';
      const infoParts = info.split('·').map(item => item.trim()).filter(Boolean);
      const cardText = card.textContent?.replace(/\s+/gu, ' ').trim() || '';
      const readMatch = cardText.match(/([\d.]+\s*万?)在读/u);
      const rankText = card.querySelector<HTMLElement>('[class*="font-mono"]')?.textContent?.trim() || '';
      return [{
        id: `fanqie:${bookId}`, sourceId: 'novelcatch-rank', sourceBookId: bookId, title,
        author: infoParts[0] || '未知作者', intro: card.querySelector<HTMLElement>('p.line-clamp-2')?.textContent?.replace(/\s+/gu, ' ').trim() || '',
        cover: mobileResolveURL(url, card.querySelector<HTMLImageElement>('img')?.getAttribute('src') || '') || undefined,
        category: card.querySelector<HTMLAnchorElement>('a[href^="/category/"]')?.textContent?.trim() || undefined,
        rank: Number(rankText) || index + 1, rankType, gender, platform: 'fanqie', url: `https://fanqienovel.com/page/${bookId}`,
        wordCount: mobileChineseNumber(infoParts.find(item => /字$/u.test(item)) || ''), readCount: readMatch ? mobileChineseNumber(readMatch[1]) : undefined,
      }];
    }).slice(0, 60);
    if (!books.length) throw new Error('番茄榜单页面没有返回可解析书籍，请稍后刷新。');
    return { books, fetchedAt: new Date().toISOString(), sourceName: '番茄小说网' };
  }
  if (platform === 'qidian') {
    const path = rankType === 'new' ? 'signnewbook' : rankType === 'read' ? 'readindex' : 'yuepiao';
    const url = `https://www.qidian.com/rank/${path}/`;
    const html = await mobileFetchHTML(url);
    if (/C2WF946J0\/probe\.js|var\s+buid\s*=|challenge|verify/iu.test(html)) throw new Error(`起点中文网${path}返回了反爬校验页，请更换代理出口或稍后重试`);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-rid], li.rank-list-item, .rank-list .book-mid-info'));
    const books = rows.flatMap((row, index) => {
      const titleLink = row.querySelector<HTMLAnchorElement>('.book-mid-info h2 a, h2 a, a[href*="/book/"]');
      const title = titleLink?.textContent?.trim() || '';
      const href = mobileResolveURL(url, titleLink?.getAttribute('href') || '');
      if (!title || !href) return [];
      const bookId = titleLink?.getAttribute('data-bid') || href.match(/\/book\/(\d+)/u)?.[1] || String(index);
      const authorLinks = Array.from(row.querySelectorAll<HTMLAnchorElement>('.book-mid-info .author a, .author a'));
      return [{ id: `qidian:${bookId}`, sourceBookId: bookId, title, author: row.querySelector<HTMLElement>('.author a.name, .author a')?.textContent?.trim() || '未知作者', intro: row.querySelector<HTMLElement>('.intro, [class*="intro"]')?.textContent?.trim() || '', cover: mobileResolveURL(url, row.querySelector<HTMLImageElement>('.book-img-box img, img')?.getAttribute('src') || '') || undefined, category: authorLinks.slice(1).map(item => item.textContent?.trim()).filter(Boolean).join(' · ') || undefined, rank: Number(row.dataset.rid) || index + 1, rankType, gender: 'all', platform: 'qidian', url: href }];
    }).slice(0, 60);
    if (books.length) return { books, fetchedAt: new Date().toISOString(), sourceName: '起点中文网官网' };
    const fallbackSeen = new Set<string>();
    const fallbackBooks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/book/"]')).flatMap((link, index) => {
      const href = mobileResolveURL(url, link.getAttribute('href') || '');
      const bookId = href.match(/\/book\/(\d+)/u)?.[1] || '';
      const title = link.textContent?.replace(/\s+/gu, ' ').trim() || '';
      if (!bookId || !title || fallbackSeen.has(bookId)) return [];
      fallbackSeen.add(bookId);
      const card = link.closest('li, article, .book-mid-info, [class*="book"]') || link.parentElement;
      return [{ id: `qidian:${bookId}`, sourceBookId: bookId, title, author: card?.querySelector<HTMLElement>('.author a, [class*="author"]')?.textContent?.trim() || '未知作者', intro: card?.querySelector<HTMLElement>('.intro, [class*="intro"]')?.textContent?.trim() || '', cover: mobileResolveURL(url, card?.querySelector<HTMLImageElement>('img')?.getAttribute('src') || '') || undefined, rank: index + 1, rankType, gender: 'all', platform: 'qidian', url: href }];
    }).slice(0, 60);
    if (!fallbackBooks.length) throw new Error(`起点中文网${path}未找到书籍条目，官网结构可能已变化`);
    return { books: fallbackBooks, fetchedAt: new Date().toISOString(), sourceName: '起点中文网官网' };
  }
  if (platform === 'faloo') {
    const url = 'https://b.faloo.com/SR_1.html';
    const document = new DOMParser().parseFromString(await mobileFetchHTML(url, 'gb18030'), 'text/html');
    const books = Array.from(document.querySelectorAll<HTMLElement>('.c_td_d_data')).flatMap((row, index) => {
      const titleLink = row.querySelector<HTMLAnchorElement>('.c_td_d_d_title a');
      const title = titleLink?.textContent?.trim() || '';
      const href = mobileResolveURL(url, titleLink?.getAttribute('href') || '');
      if (!title || !href) return [];
      const bookId = href.match(/\/(\d+)\.html/u)?.[1] || String(index);
      return [{ id: `faloo:${bookId}`, sourceBookId: bookId, title, author: row.querySelector<HTMLElement>('.c_td_d_d_author')?.textContent?.trim() || '未知作者', intro: '', cover: mobileResolveURL(url, row.querySelector<HTMLImageElement>('.c_td_d_d_img img')?.getAttribute('src') || '').replace(/^http:/iu, 'https:') || undefined, category: row.querySelector<HTMLElement>('.c_td_d_d_class')?.textContent?.trim() || undefined, rank: Number(row.querySelector<HTMLElement>('[class^="c_td_d_d_number"]')?.textContent?.trim()) || index + 1, rankType: 'read', gender: 'all', platform: 'faloo', url: href }];
    }).slice(0, 60);
    if (!books.length) throw new Error('飞卢24小时畅销榜没有返回可解析书籍。');
    return { books, fetchedAt: new Date().toISOString(), sourceName: '飞卢中文网官网' };
  }
  throw new Error('未知扫榜平台。');
};

const mobileFanqieSearch = async (query: string) => {
  const encoded = encodeURIComponent(query);
  const endpoint = `https://fanqienovel.com/api/author/search/search_book/v1?filter=127%2C127%2C127%2C127&page_count=20&page_index=0&query_type=0&query_word=${encoded}`;
  const books: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  try {
    const payload = JSON.parse(await mobileFetchHTML(endpoint, 'utf-8')) as Record<string, unknown>;
    const root = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : payload;
    const list = Array.isArray(root.search_book_data_list) ? root.search_book_data_list : [];
    list.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      const sourceBookId = String(record.book_id || record.bookId || record.id || '').trim();
      const title = String(record.book_name || record.bookName || record.title || '').trim();
      if (!sourceBookId || !title || seen.has(sourceBookId)) return;
      seen.add(sourceBookId);
      books.push({ id: `fanqie:${sourceBookId}`, sourceId: 'fanqie', sourceBookId, source: '番茄小说', title,
        author: String(record.author || record.author_name || '未知作者'), intro: String(record.abstract || record.introduction || record.description || '').slice(0, 320),
        cover: String(record.thumb_url || record.thumbUri || record.cover || '') || undefined, category: String(record.category || '') || undefined,
        wordCount: Number(record.word_count || record.wordCount) || undefined, url: `https://fanqienovel.com/page/${sourceBookId}` });
    });
  } catch { /* Search pages can be challenged; the HTML fallback below remains available. */ }
  if (!books.length) {
    try {
      const document = new DOMParser().parseFromString(await mobileFetchHTML(`https://fanqienovel.com/search/${encoded}`), 'text/html');
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/page/"]')).forEach(link => {
        const sourceBookId = link.getAttribute('href')?.match(/\/page\/(\d+)/u)?.[1] || '';
        const title = link.textContent?.replace(/\s+/gu, ' ').trim() || '';
        if (!sourceBookId || !title || seen.has(sourceBookId)) return;
        seen.add(sourceBookId);
        books.push({ id: `fanqie:${sourceBookId}`, sourceId: 'fanqie', sourceBookId, source: '番茄小说', title, author: '未知作者', intro: '', url: `https://fanqienovel.com/page/${sourceBookId}` });
      });
    } catch { /* Return a normal empty search result instead of invoking the model. */ }
  }
  return { books: books.slice(0, 100), searchedSourceCount: 1, responsiveSourceCount: 1, failedSourceCount: 0 };
};

const mobileQianyueSources = (qianyueSourceData as MobileQianyueSource[])
  .map((source, index) => ({ ...source, id: source.bookSourceName === '酷我小说[api]' ? 'qianyue-kuwo' : `qianyue-${index}`, name: String(source.bookSourceName || `千阅书源 ${index + 1}`) }))
  .filter(source => source.enabled !== false && Boolean(source.bookSourceUrl) && Boolean(source.searchUrl) && !/^(?:@js:|<js>|\{\{)/iu.test(String(source.searchUrl)));

const mobileSourceBase = (source: MobileQianyueSource) => String(source.bookSourceUrl || '').split('##')[0].trim().replace(/\/+$/u, '');
const mobileSourceHeaders = (source: MobileQianyueSource): Record<string, string> => {
  const raw = String(source.header || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw.replace(/'/gu, '"')) as Record<string, unknown>;
    const headers = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
    if (authorization) {
      const token = authorization[1].replace(/^Bearers+/iu, '').trim();
      const payload = token.split('.')[1];
      if (payload) {
        try {
          const normalized = payload.replace(/-/gu, '+').replace(/_/gu, '/');
          const exp = Number(JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))).exp);
          if (Number.isFinite(exp) && exp > 0 && exp <= Math.floor(Date.now() / 1000)) delete headers[authorization[0]];
        } catch { /* Keep opaque non-JWT authorization headers. */ }
      }
    }
    return headers;
  } catch { return {}; }
};

const mobileRuleTemplate = (template: unknown, item: unknown, query: string, page = 1, baseUrl = '') => String(template || '')
  .replace(/\{\{key\}\}/giu, encodeURIComponent(query))
  .replace(/\{\{page(?:-1)?\}\}/giu, match => match.includes('-1') ? '0' : String(page))
  .replace(/\{\{baseUrl\}\}/giu, baseUrl)
  .replace(/\{\{baseUrl\.replace\(['"]([^'"]*)['"],['"]([^'"]*)['"]\)\}\}/giu, (_match, from: string, to: string) => baseUrl.replace(from, to))
  .replace(/\{\{?\$\.([^}]+)\}\}?/gu, (_match, path: string) => String(mobileJsonPath(item, `$.${path.trim()}`)[0] ?? ''));

type MobileSourceRequest = { url: string; method: 'GET' | 'POST'; body?: string; headers: Record<string, string>; encoding: string };

const mobileSourceRequestFromRule = (source: MobileQianyueSource, rule: unknown, item: unknown, query = '', page = 1): MobileSourceRequest | null => {
  const raw = mobileRuleTemplate(rule, item, query, page, mobileSourceBase(source)).trim();
  if (!raw || /^(?:@js:|<js>|\{\{)/iu.test(raw)) return null;
  const descriptorIndex = raw.search(/,\s*\{/u);
  const urlPart = (descriptorIndex >= 0 ? raw.slice(0, descriptorIndex) : raw).replace(/\n/gu, '').trim();
  let descriptor: Record<string, unknown> = {};
  if (descriptorIndex >= 0) {
    try { descriptor = JSON.parse(raw.slice(descriptorIndex + 1).trim()) as Record<string, unknown>; } catch { return null; }
  }
  let url = '';
  try { url = new URL(urlPart, `${mobileSourceBase(source)}/`).toString(); } catch { return null; }
  const method = String(descriptor.method || (descriptor.body ? 'POST' : 'GET')).toUpperCase() === 'POST' ? 'POST' : 'GET';
  const body = typeof descriptor.body === 'string' ? mobileRuleTemplate(descriptor.body, {}, query, page) : undefined;
  const headers = { ...mobileSourceHeaders(source), ...(descriptor.headers && typeof descriptor.headers === 'object' ? descriptor.headers as Record<string, string> : {}) };
  if (body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
  return { url, method, body, headers, encoding: String(descriptor.charset || 'utf-8') };
};

const mobileSourceRequest = (source: MobileQianyueSource, query: string, page = 1): MobileSourceRequest | null => mobileSourceRequestFromRule(source, source.searchUrl, {}, query, page);

const mobileJsonPath = (input: unknown, rawRule: unknown): unknown[] => {
  const rule = String(rawRule || '').replace(/^@JSon:/iu, '').split('##')[0].replace(/\{\{?|\}\}?/gu, '').trim();
  if (!rule) return [];
  const alternatives = rule.split('||').map(item => item.trim()).filter(Boolean);
  const walk = (value: unknown, parts: string[]): unknown[] => {
    if (!parts.length) return Array.isArray(value) ? value : [value];
    const [part, ...rest] = parts;
    if (part === '*' || part === '[*]') return Array.isArray(value) ? value.flatMap(item => walk(item, rest)) : [];
    const keyMatch = part.match(/^([^[]+)?(?:\[(\d+|\*)\])?$/u);
    if (!keyMatch) return [];
    const key = keyMatch[1];
    const index = keyMatch[2];
    const next = key ? value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined : value;
    if (index === '*') return Array.isArray(next) ? next.flatMap(item => walk(item, rest)) : [];
    if (index !== undefined) return Array.isArray(next) ? walk(next[Number(index)], rest) : [];
    return walk(next, rest);
  };
  const recursive = (value: unknown, key: string): unknown[] => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    return Object.entries(record).flatMap(([entryKey, entryValue]) => [
      ...(entryKey === key ? (Array.isArray(entryValue) ? entryValue : [entryValue]) : []),
      ...recursive(entryValue, key),
    ]);
  };
  for (const alternative of alternatives) {
    if (alternative.startsWith('$..')) {
      const values = recursive(input, alternative.slice(3).split(/[.[\]]/u)[0]);
      if (values.length) return values;
      continue;
    }
    const parts = alternative.replace(/^\$\.?/u, '').split('.').filter(Boolean);
    const values = walk(input, parts);
    if (values.length) return values;
  }
  return [];
};

const mobileRuleText = (value: string, rule: unknown) => {
  const raw = String(rule || '').trim();
  if (!raw) return '';
  const sections = raw.split('##');
  let output = value;
  if (sections[1]) {
    try { output = output.replace(new RegExp(sections[1], 'gu'), sections[2] || ''); } catch { /* Ignore invalid source regex. */ }
  }
  return output.replace(/\s+/gu, ' ').trim();
};

const mobileCssSelector = (part: string) => part
  .replace(/^class\./iu, '.')
  .replace(/^id\./iu, '#')
  .replace(/^tag\./iu, '')
  .replace(/!\d+$/u, '')
  .replace(/:\d+$/u, '');

const mobileHtmlNodes = (root: ParentNode, selectorRule: string): Element[] => {
  const selector = mobileCssSelector(selectorRule.split('@')[0].trim());
  if (!selector || selector.startsWith('@')) return [];
  try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
};

const mobileHtmlValue = (root: Element, rule: unknown, baseUrl: string): string => {
  const alternatives = String(rule || '').split('&&').map(item => item.trim()).filter(Boolean);
  for (const alternative of alternatives) {
    const sections = alternative.split('##');
    const chain = sections[0].split('@').map(item => item.trim()).filter(Boolean);
    let nodes: Element[] = [root];
    let mode = 'text';
    for (const part of chain) {
      if (part === 'text' || part === 'textNodes') { mode = 'text'; continue; }
      if (part === 'href' || part === 'src' || part === 'title' || part === 'onclick') { mode = part; continue; }
      const indexMatch = part.match(/^(.*)\.(\d+)$/u);
      const selector = mobileCssSelector(indexMatch?.[1] || part);
      const index = indexMatch ? Number(indexMatch[2]) : 0;
      nodes = nodes.flatMap(node => mobileHtmlNodes(node, selector).slice(index, index + 1));
      if (!nodes.length) break;
    }
    const node = nodes[0];
    if (!node) continue;
    let value = mode === 'text' ? node.textContent || '' : node.getAttribute(mode) || '';
    value = mobileRuleText(value, sections.length > 1 ? `##${sections.slice(1).join('##')}` : '');
    if ((mode === 'href' || mode === 'src') && value) {
      try { value = new URL(value, baseUrl).toString(); } catch { /* Keep original URL. */ }
    }
    if (value) return value;
  }
  return '';
};

const mobileSearchOneQianyueSource = async (source: MobileQianyueSource & { id: string; name: string }, query: string): Promise<Record<string, unknown>[]> => {
  const request = mobileSourceRequest(source, query);
  if (!request) return [];
  const html = await mobileFetchHTML(request.url, request.encoding, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body } : {}),
  });
  const payload = html.trim();
  const rule = source.ruleSearch || {};
  let json: unknown = null;
  try { json = JSON.parse(payload) as unknown; } catch { /* HTML source. */ }
  const baseUrl = mobileSourceBase(source) || request.url;
  const items = json !== null ? mobileJsonPath(json, rule.bookList) : mobileHtmlNodes(new DOMParser().parseFromString(payload, 'text/html'), String(rule.bookList || ''));
  return items.flatMap((item, index): Record<string, unknown>[] => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const scalar = (field: string) => {
      if (json === null) return mobileHtmlValue(item instanceof Element ? item : document.createElement('div'), rule[field], baseUrl);
      const rawRule = String(rule[field] || '').trim();
      const expanded = mobileRuleTemplate(rawRule, item, query).trim();
      const hasTemplateValue = expanded !== rawRule && !/@js:|<js>/iu.test(rawRule);
      const isLiteralUrl = field === 'bookUrl' && /^(?:https?:|\/)/iu.test(expanded);
      const value = hasTemplateValue || isLiteralUrl
        ? expanded.split(/\n@js:|@js:/iu)[0].trim()
        : String(mobileJsonPath(item, rawRule).find(value => value !== undefined && value !== null) ?? '');
      return mobileRuleText(value, rawRule);
    };
    const title = mobileRuleText(scalar('name'), rule.name) || (typeof record.title === 'string' ? record.title : '');
    const author = mobileRuleText(scalar('author'), rule.author) || '未知作者';
    const sourceBookId = String(record.bookId || record.book_id || record.novelId || record.nid || `${source.id}-${index}`);
    let bookUrl = scalar('bookUrl');
    const descriptorIndex = bookUrl.search(/,\s*\{/u);
    if (descriptorIndex >= 0) bookUrl = bookUrl.slice(0, descriptorIndex).trim();
    if (bookUrl && !/^https?:\/\//iu.test(bookUrl)) { try { bookUrl = new URL(bookUrl, baseUrl).toString(); } catch { /* Keep relative. */ } }
    if (!title || !bookUrl || /[{}@]/u.test(bookUrl)) return [];
    return [{
      id: `${source.id}:${sourceBookId}:${index}`, sourceId: source.id, sourceBookId, source: source.name, title, author,
      intro: mobileRuleText(scalar('intro'), rule.intro), cover: scalar('coverUrl') || undefined,
      category: mobileRuleText(scalar('kind'), rule.kind) || undefined, wordCount: Number(scalar('wordCount')) || undefined, url: bookUrl,
    }];
  });
};

type MobileSourcePayload = { request: MobileSourceRequest; text: string; json: unknown | null };

const mobileFetchSourceRule = async (source: MobileQianyueSource, rule: unknown, item: unknown, query = '', page = 1): Promise<MobileSourcePayload> => {
  const request = mobileSourceRequestFromRule(source, rule, item, query, page);
  if (!request) throw new Error('书源规则包含当前移动端不支持的脚本地址');
  const text = await mobileFetchHTML(request.url, request.encoding, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body } : {}),
  });
  let json: unknown = null;
  try { json = JSON.parse(text) as unknown; } catch { /* HTML source. */ }
  return { request, text, json };
};

const mobileSourceValue = (payload: MobileSourcePayload, item: unknown, rule: unknown, field = ''): string => {
  const rawRule = String(rule || '').trim();
  if (!rawRule) return '';
  if (payload.json !== null) {
    const expanded = mobileRuleTemplate(rawRule, item, '', 1, new URL(payload.request.url).origin).trim();
    const hasTemplateValue = expanded !== rawRule && !/@js:|<js>/iu.test(rawRule);
    const isLiteral = /^(?:https?:|\/)/iu.test(expanded) && (field === 'bookUrl' || field === 'coverUrl' || field === 'tocUrl');
    const value = hasTemplateValue || isLiteral ? expanded.split(/\n@js:|@js:/iu)[0].trim() : String(mobileJsonPath(item, rawRule).find(entry => entry !== undefined && entry !== null) ?? '');
    return mobileRuleText(value, rawRule);
  }
  const document = new DOMParser().parseFromString(payload.text, 'text/html');
  return mobileHtmlValue(document.body, rawRule, new URL(payload.request.url).origin);
};

const mobileSourceChapterId = (sourceId: string, url: string, index: number) => `${sourceId}:chapter:${index + 1}:${url || 'missing'}`;

const mobileConcurrentMap = async <Item, Result>(items: Item[], concurrency: number, work: (item: Item, index: number) => Promise<Result>): Promise<Result[]> => {
  const results = new Array<Result>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
};

const mobileQianyueDownload = async (source: MobileQianyueSource & { id: string; name: string }, title: string, author: string, sourceBookId: string, bookUrl: string, maxChapters = Number.MAX_SAFE_INTEGER): Promise<Record<string, unknown>> => {
  const info = await mobileFetchSourceRule(source, bookUrl, {});
  const infoRoot = info.json !== null && source.ruleBookInfo?.init ? mobileJsonPath(info.json, source.ruleBookInfo.init)[0] || info.json : info.json;
  const tocRule = source.ruleBookInfo?.tocUrl || bookUrl;
  const toc = await mobileFetchSourceRule(source, tocRule, infoRoot || {});
  const chapterItems = toc.json !== null
    ? mobileJsonPath(toc.json, source.ruleToc?.chapterList)
    : mobileHtmlNodes(new DOMParser().parseFromString(toc.text, 'text/html'), String(source.ruleToc?.chapterList || ''));
  if (!chapterItems.length) throw new Error(`${source.name} 没有返回章节目录`);
  const selected = chapterItems.slice(0, Math.max(1, maxChapters));
  const chapters = await mobileConcurrentMap(selected, 4, async (item, index): Promise<Record<string, unknown>> => {
    const chapterTitle = mobileSourceValue(toc, item, source.ruleToc?.chapterName) || `第 ${index + 1} 章`;
    const chapterRule = String(source.ruleToc?.chapterUrl || '').trim();
    const chapterUrl = mobileRuleTemplate(chapterRule, item, '', 1, new URL(toc.request.url).origin).split(/\n@js:|@js:/iu)[0].trim();
    const resolvedUrl = chapterUrl && !/^https?:\/\//iu.test(chapterUrl) ? mobileResolveURL(toc.request.url, chapterUrl) : chapterUrl;
    const baseChapter = { id: mobileSourceChapterId(source.id, resolvedUrl, index), number: index + 1, title: chapterTitle, url: resolvedUrl };
    if (!resolvedUrl || /\$\.|\{\{|@js:|<js>/iu.test(resolvedUrl)) {
      return { ...baseChapter, content: '', wordCount: 0, downloaded: false, unavailableReason: '章节地址包含暂不支持的脚本规则' };
    }
    try {
      const contentPayload = await mobileFetchSourceRule(source, resolvedUrl, {});
      const content = mobileSourceValue(contentPayload, contentPayload.json ?? {}, source.ruleContent?.content, 'content').replace(/\n{3,}/gu, '\n\n').trim();
      return { ...baseChapter, content, wordCount: content.replace(/\s/gu, '').length, downloaded: Boolean(content), ...(content ? {} : { unavailableReason: '书源没有返回本章正文' }) };
    } catch (error) {
      return { ...baseChapter, content: '', wordCount: 0, downloaded: false, unavailableReason: error instanceof Error ? error.message : String(error) };
    }
  });
  return { title: title || '未命名书籍', author: author || '未知作者', sourceId: source.id, sourceName: source.name, sourceBookId: sourceBookId || bookUrl, chapters, downloadedChapterCount: chapters.filter(chapter => chapter.downloaded === true).length, completedChapterCount: chapters.filter(chapter => chapter.downloaded === true).length };
};

const mobileQianyueDownloadChapter = async (source: MobileQianyueSource & { id: string; name: string }, chapter: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const url = String(chapter.url || '').trim();
  if (!url || /\$\.|\{\{|@js:|<js>/iu.test(url)) throw new Error('该章节缺少可下载地址');
  const payload = await mobileFetchSourceRule(source, url, {});
  const content = mobileSourceValue(payload, payload.json ?? {}, source.ruleContent?.content, 'content').replace(/\n{3,}/gu, '\n\n').trim();
  if (!content) throw new Error(`${source.name} 没有返回本章正文`);
  return { ...chapter, content, wordCount: content.replace(/\s/gu, '').length, downloaded: true, unavailableReason: undefined };
};

const mobileSearchAllQianyue = async (query: string) => {
  // API and HTTPS sources have stable structured search responses on iOS.
  // Run them first so a slow or retired HTML source cannot make a valid title
  // appear as an empty search result.
  const preferredSourceIds = ['qianyue-0', 'qianyue-3', 'qianyue-4', 'qianyue-17', 'qianyue-27', 'qianyue-kuwo', 'qianyue-70'];
  const preferred = preferredSourceIds.map(id => mobileQianyueSources.find(source => source.id === id)).filter((source): source is typeof mobileQianyueSources[number] => Boolean(source));
  const fallback = mobileQianyueSources.filter(source => !preferredSourceIds.includes(source.id)).slice(0, 36);
  const sources = [{ id: 'fanqie', name: '番茄小说' }, ...preferred, ...fallback];
  const results: Array<Record<string, unknown>> = [];
  let responsiveSourceCount = 0;
  let failedSourceCount = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < sources.length) {
      const source = sources[cursor]; cursor += 1;
      let result: { books?: Record<string, unknown>[]; failed?: boolean };
      if (source.id === 'fanqie') result = await mobileFanqieSearch(query);
      else {
        try { result = { books: await mobileSearchOneQianyueSource(source, query) }; }
        catch { result = { failed: true, books: [] }; }
      }
      if (result.failed) failedSourceCount += 1; else responsiveSourceCount += 1;
      results.push(...(result.books || []));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, sources.length) }, () => worker()));
  const seen = new Set<string>();
  const normalize = (value: unknown) => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const needle = normalize(query);
  const score = (book: Record<string, unknown>) => {
    const title = normalize(book.title);
    if (title === needle) return 1_000;
    if (title.includes(needle)) return 800 - Math.min(240, title.length - needle.length);
    if (needle.includes(title)) return 620 - Math.min(240, needle.length - title.length);
    return normalize(book.author).includes(needle) ? 520 : 0;
  };
  const books = results.filter(book => { const key = `${book.sourceId}:${book.sourceBookId || book.url}`; if (seen.has(key)) return false; seen.add(key); return Boolean(book.title && book.url); }).sort((left, right) => score(right) - score(left)).slice(0, 150);
  return { books, searchedSourceCount: sources.length, responsiveSourceCount, failedSourceCount };
};


export {
  mobileFanqieSearch,
  mobileNovelCatchCategories,
  mobileRankingFetch,
  mobileQianyueSources,
  mobileSearchOneQianyueSource,
  mobileQianyueDownload,
  mobileQianyueDownloadChapter,
  mobileSearchAllQianyue,
};
