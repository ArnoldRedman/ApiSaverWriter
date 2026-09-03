import { ModelApiClient } from "../models/model-api.js";
import { mapWithConcurrency } from "./concurrency.js";

/**
 * 章节标题属于标题栏，不属于正文：模型爱在正文开头补一道 # 标题，存入前拆出来
 * 标题不能直接丢掉——它是模型唯一给出章节名的地方，丢了标题栏就只剩“第 N 章”占位
 * 模型偶尔连写多行重复标题，最多剥 3 行；标题只取第一行
 */
export function splitChapterTitleHeading(value: string): { title: string; content: string } {
  let text = value.trim();
  let title = "";
  for (let round = 0; round < 3; round += 1) {
    const match = /^#{1,3}\s*([^\n]{1,40})\n+/u.exec(text);
    if (!match) break;
    const titleLine = match[1].trim();
    // 只有看起来像章节名才剥（含“第 x 章”或较短且无标点的标题）；避免误伤正文里合法的 Markdown 小节
    const looksLikeChapterTitle = /第[\s\d零一二三四五六七八九十百千两]+章/u.test(titleLine)
      || (titleLine.length > 0 && !/[，。！？；：、“”…—]/u.test(titleLine) && titleLine.length <= 20);
    const rest = text.slice(match[0].length).trim();
    if (!looksLikeChapterTitle || !rest) break;
    if (!title) title = titleLine;
    text = rest;
  }
  return { title, content: text };
}

/** 新建章节时自动生成的编号占位标题，作者和项目 Agent 都还没给这一章起名 */
const numberedPlaceholderTitle = /^第\s*[\d零一二三四五六七八九十百千两]+\s*[章回节]$/u;
/** 连章号都没有的占位标题 */
const blankPlaceholderTitle = /^(?:新章节|未命名章节|无标题)$/u;
/** 标题名前的章号前缀：模型经常把章号数错，章号一律以应用自己的编号为准 */
const chapterNumberPrefix = /^第\s*[\d零一二三四五六七八九十百千两]+\s*[章回节]\s*[：:·、.\-—]?\s*/u;

/** 这一章还没有真正的名字，只有创建时的编号占位 */
export function isPlaceholderChapterTitle(value: string): boolean {
  const current = value.trim();
  return !current || numberedPlaceholderTitle.test(current) || blankPlaceholderTitle.test(current);
}

/**
 * 用模型写在正文开头的标题行补全章节标题
 * 已经起过名的标题保持原样；只有占位标题才补，且沿用调用方自己的章号
 */
export function applyDraftChapterTitle(currentTitle: string, draftHeading: string): string {
  const name = draftHeading.trim().replace(chapterNumberPrefix, "").trim();
  if (!name) return currentTitle;
  const current = currentTitle.trim();
  if (numberedPlaceholderTitle.test(current)) return `${current} ${name}`;
  if (!current || blankPlaceholderTitle.test(current)) return name;
  return currentTitle;
}

export interface ChapterTitleCandidate {
  targetId: number;
  /** 当前标题，通常是「第 N 章」这种占位；生成的名字会接在它后面 */
  currentTitle: string;
  content: string;
}

export interface ChapterTitleEntry {
  targetId: number;
  title: string;
  /** 标题原本写在正文开头（旧版本遗留），应用时要把那行从正文里移走 */
  stripHeading?: boolean;
}

export interface ChapterTitleResult {
  entries: ChapterTitleEntry[];
  /** 从正文里直接捡回来的章数，这部分不花任何模型调用 */
  recovered: number;
  /** 交给模型命名的章数 */
  named: number;
  /** 没能命名的批次原因，交给调用方写进 toolEvents */
  failures: string[];
}

/** 一次模型请求里塞多少章：标题只有十来个字，章数堆多了反而让模型偷懒串味 */
const TITLE_BATCH_SIZE = 20;
/** 同时发几批：批量命名是纯等待，但并发太高会被上游限流 */
/** 同时发几批：批量命名是纯等待，但并发太高会被上游限流 */
const TITLE_BATCH_CONCURRENCY = 3;
/** 一批全挂后最多再逐章补几次命名：通常只需一两次，设上限防失控 */
const TITLE_SINGLE_RETRY_LIMIT = 12;

/**
 * 模型回包里的标题行
 * 兼容三种形状：{"index":1,"title":"名"}、{"id":150,"title":"名"}、纯字符串
 */
function collectTitleRows(parsed: unknown): Array<{ index: number | null; id: string; title: string }> {
  const rows: Array<{ index: number | null; id: string; title: string }> = [];
  if (Array.isArray(parsed)) {
    for (const row of parsed) collectTitleRowsInto(row, rows);
    return rows;
  }
  if (!parsed || typeof parsed !== "object") return rows;
  const record = parsed as Record<string, unknown>;
  for (const key of ["titles", "chapters", "items", "results", "data"]) {
    if (Array.isArray(record[key])) {
      for (const row of record[key]) collectTitleRowsInto(row, rows);
      return rows;
    }
  }
  // 有的模型直接把映射当回包：{"9":"夜雨敲窗","10":"口供"}，键是章号
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim() && /\d/u.test(key)) rows.push({ index: null, id: key, title: value });
  }
  return rows;
}

function collectTitleRowsInto(row: unknown, rows: Array<{ index: number | null; id: string; title: string }>): void {
  if (typeof row === "string") {
    if (row.trim()) rows.push({ index: null, id: "", title: row });
    return;
  }
  if (!row || typeof row !== "object") return;
  const record = row as Record<string, unknown>;
  const title = [record.title, record.chapterTitle, record.name, record["标题"]].find(value => typeof value === "string" && value.trim());
  if (typeof title !== "string" || !title.trim()) return;
  // index/序号 是新约定；旧约定的 id、以及把章号当 id 返回的情况都在这里兼容
  const index = firstNumericField(record.index ?? record["序号"] ?? record.number ?? record.order);
  const id = String(record.id ?? record.targetId ?? record.chapterId ?? "");
  rows.push({ index: index ?? null, id, title });
}

function firstNumericField(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * 把模型回的标题行配到具体章节上
 * 配对按“序号 → 章号（第 N 章里的 N）→ 十几位真实 id → 数量对上时按位置”四层降级：
 * 模型最常把章号当 id 返回（列表里只有“第 9 章”没有 9 这个 id），只按真实 id 硬配会把整批全丢掉
 */
function matchTitleRow(row: { index: number | null; id: string }, batch: readonly ChapterTitleCandidate[], used: Set<number>): ChapterTitleCandidate | null {
  const chapterNumber = (candidate: ChapterTitleCandidate) => Number(/^第\s*([\d零一二三四五六七八九十百千两]+)\s*[章回节]/u.exec(candidate.currentTitle.trim())?.[1] ?? Number.NaN);
  if (row.index !== null) {
    const target = batch.find((item, i) => !used.has(i) && chapterNumber(item) === row.index) || batch.find((item, i) => !used.has(i) && i + 1 === row.index);
    if (target) return target;
  }  const rawId = row.id.trim();
  if (rawId) {
    const idNumber = Number(rawId);
    const byExactId = batch.find((item, i) => !used.has(i) && String(item.targetId) === rawId);
    const byNumber = Number.isFinite(idNumber) && idNumber > 0 ? batch.find((item, i) => !used.has(i) && (chapterNumber(item) === idNumber || i + 1 === idNumber)) : undefined;
    const target = byExactId || byNumber;
    if (target) return target;
  }
  return null;
}

const titleSystemPrompt = `你是中文长篇网文的责任编辑，正在为已经写好的章节补标题。

要求：
1. 每个标题只概括该章真正发生的事，不得使用别章的情节，不得凭空发明设定。
2. 4 到 14 个汉字，不带“第几章”前缀，不带书名号、引号、句号和省略号。
3. 同一批里的标题必须互不相同，不要都写成“危机”“转机”这类空词。
4. 严格返回 JSON 对象：{"titles":[{"index":序号,"title":"标题"}]}，不要代码围栏，不要解释。index 直接抄回各章开头的“第 X 章”那个 X。
5. 给了几章就返回几条，不要新增或漏掉章节。`;

const singleTitleSystemPrompt = `你是中文长篇网文的责任编辑，正在为刚写完的一章起标题。

要求：
1. 只概括这一章真正发生的事，不得凭空发明设定。
2. 4 到 14 个汉字，不带“第几章”前缀，不带书名号、引号、句号和省略号。
3. 严格返回 JSON 对象：{"title":"标题"}，不要代码围栏，不要解释。`;

/** 正文摘录：开头交代场景、结尾交代钩子，标题基本只靠这两段就能定 */
function titleExcerpt(content: string): string {
  const text = content.trim().replace(/\s*\n\s*\n\s*/gu, "\n");
  if (text.length <= 900) return text;
  return `${text.slice(0, 620)}\n……\n${text.slice(-260)}`;
}

/** 模型给的标题名里常带的多余包装：书名号、引号、句末标点和自己数的章号 */
export function cleanChapterTitleName(value: string): string {
  let name = value.trim().split(/\n/u)[0].trim();
  // “《夜雨敲窗》。”这种套层要反复剥：单轮只能去掉最外一层
  for (let round = 0; round < 4; round += 1) {
    const stripped = name
      .replace(/^[《【\["'“‘（(]+/u, "")
      .replace(/[》】\]"'”’）)]+$/u, "")
      .replace(/[。！？…、；，!?]+$/u, "")
      .trim();
    if (stripped === name) break;
    name = stripped;
  }
  return name.slice(0, 60);
}

/**
 * 给单独一章起标题
 * 章节智能体写完正文后如果没在信封里给出标题，这一章就只剩“第 N 章”占位；
 * 补一次极小的命名请求（几十 token）比让作者自己回头挨章补名划算得多。
 * 失败时返回空串：标题缺失不该让整章正文作废。
 */
export async function generateChapterTitle(
  client: ModelApiClient,
  content: string,
  options: { projectTitle?: string; instruction?: string } = {},
): Promise<string> {
  const excerpt = titleExcerpt(content);
  if (!excerpt) return "";
  try {
    const response = await client.chat([
      { role: "system", content: singleTitleSystemPrompt },
      { role: "user", content: `《${options.projectTitle || "未命名小说"}》刚写完一章。${options.instruction?.trim() ? `\n作者本章要求：${options.instruction.trim().slice(0, 400)}` : ""}\n\n${excerpt}` },
    ], { response_format: { type: "json_object" }, temperature: 0.5, max_tokens: 200, retryAttempts: 2 });
    const cleaned = response.content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const name = [parsed.title, parsed.chapterTitle, parsed["标题"]].find(value => typeof value === "string" && value.trim());
    return typeof name === "string" ? cleanChapterTitleName(name) : "";
  } catch {
    return "";
  }
}

/**
 * 批量补章节标题
 * 分两段走：先把旧版本遗留在正文开头的 # 标题行直接捡回来（零模型调用），
 * 剩下真的没有名字的章节才分批交给模型命名。
 * 一批失败只丢这一批并如实报出来，其余章节照常返回。
 */
/**
 * 配不上的章节逐章补一次命名
 * 单章回包只有 {"title":"名"} 一种形状，出错空间小；一次几十 token，最多重试 TITLE_SINGLE_RETRY_LIMIT 章防失控
 */
async function retrySingles(
  source: { client: ModelApiClient; projectTitle: string },
  missing: readonly ChapterTitleCandidate[],
  options: { instruction?: string },
): Promise<{ entries: ChapterTitleEntry[]; missing: ChapterTitleCandidate[] }> {
  if (!missing.length) return { entries: [], missing: [] };
  const capped = missing.slice(0, TITLE_SINGLE_RETRY_LIMIT);
  const entries: ChapterTitleEntry[] = [];
  const still: ChapterTitleCandidate[] = missing.slice(TITLE_SINGLE_RETRY_LIMIT);
  for (const candidate of capped) {
    const name = await generateChapterTitle(source.client, candidate.content, {
      projectTitle: source.projectTitle,
      instruction: options.instruction,
    });
    if (!name) {
      still.push(candidate);
      continue;
    }
    const title = applyDraftChapterTitle(candidate.currentTitle, name);
    if (title.trim() === candidate.currentTitle.trim()) {
      still.push(candidate);
      continue;
    }
    entries.push({ targetId: candidate.targetId, title: title.slice(0, 160) });
  }
  return { entries, missing: still };
}

/** 失败名单里的章号列表，拼进提示语让作者知道再说一次时点哪些章 */
function labelList(missing: readonly ChapterTitleCandidate[]): string {
  const labels = missing.map(item => {
    const chapterNumber = /^第\s*([\d零一二三四五六七八九十百千两]+)\s*[章回节]/u.exec(item.currentTitle.trim())?.[1];
    return chapterNumber ? `第 ${chapterNumber} 章` : (item.currentTitle.trim() || `id=${item.targetId}`);
  });
  return labels.length > 5 ? `${labels.slice(0, 5).join("、")} 等 ${labels.length} 章` : labels.join("、");
}

export async function generateChapterTitles(
  client: ModelApiClient,
  candidates: readonly ChapterTitleCandidate[],
  options: { instruction?: string; projectTitle?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<ChapterTitleResult> {
  const entries: ChapterTitleEntry[] = [];
  const failures: string[] = [];
  const pending: ChapterTitleCandidate[] = [];
  let recovered = 0;

  for (const candidate of candidates) {
    const draft = splitChapterTitleHeading(candidate.content);
    if (!draft.title) {
      if (candidate.content.trim()) pending.push(candidate);
      else failures.push(`章节 ${candidate.targetId} 没有正文，无法起名`);
      continue;
    }
    // 正文开头本来就写着标题：搬到标题栏并把那一行从正文里移走，不需要问模型
    const title = applyDraftChapterTitle(candidate.currentTitle, draft.title);
    entries.push({ targetId: candidate.targetId, title: title.slice(0, 160), stripHeading: true });
    recovered += 1;
  }
  options.onProgress?.(recovered, candidates.length);

  const batches: ChapterTitleCandidate[][] = [];
  for (let index = 0; index < pending.length; index += TITLE_BATCH_SIZE) {
    batches.push(pending.slice(index, index + TITLE_BATCH_SIZE));
  }
  let done = recovered;
  const extra = options.instruction?.trim() ? `\n作者额外要求：${options.instruction.trim()}` : "";
  const singleFallbackClient = { client, projectTitle: options.projectTitle || "" };

  const batchResults = await mapWithConcurrency(batches, TITLE_BATCH_CONCURRENCY, async batch => {
    const listing = batch
      .map(item => `### ${item.currentTitle.trim() || "无标题"}（index=${/^第\s*([\d零一二三四五六七八九十百千两]+)\s*[章回节]/u.exec(item.currentTitle.trim())?.[1] ?? "无章号"}）\n${titleExcerpt(item.content)}`)
      .join("\n\n");
    const produced: ChapterTitleEntry[] = [];
    const missing: ChapterTitleCandidate[] = [];
    try {
      const response = await client.chat([
        { role: "system", content: titleSystemPrompt },
        { role: "user", content: `《${options.projectTitle || "未命名小说"}》需要补标题的章节共 ${batch.length} 章。${extra}\n\n${listing}` },
      ], { response_format: { type: "json_object" }, temperature: 0.5, max_tokens: 1200, retryAttempts: 3 });
      const cleaned = response.content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
      const parsed = JSON.parse(cleaned) as unknown;
      const rows = collectTitleRows(parsed);
      const used = new Set<number>();
      const leftovers: Array<{ index: number | null; id: string; title: string }> = [];
      for (const row of rows) {
        const candidate = matchTitleRow(row, batch, used);
        if (!candidate) {
          // 配不上的行先攒着：数量对得上时按位置兑底，一行都别浪费
          leftovers.push(row);
          continue;
        }
        const name = cleanChapterTitleName(row.title);
        if (!name) continue;
        const title = applyDraftChapterTitle(candidate.currentTitle, name);
        if (title.trim() === candidate.currentTitle.trim()) continue;
        used.add(batch.indexOf(candidate));
        produced.push({ targetId: candidate.targetId, title: title.slice(0, 160) });
      }
      // 模型不带任何键、纯按顺序回标题时（或键全写错时）：回包行数与批次相等就按位置配
      const unmatched = batch.filter((_, i) => !used.has(i));
      if (leftovers.length === unmatched.length && unmatched.length > 0) {
        unmatched.forEach((candidate, i) => {
          const name = cleanChapterTitleName(leftovers[i].title);
          if (!name) return;
          const title = applyDraftChapterTitle(candidate.currentTitle, name);
          if (title.trim() === candidate.currentTitle.trim()) return;
          used.add(batch.indexOf(candidate));
          produced.push({ targetId: candidate.targetId, title: title.slice(0, 160) });
        });
      }
      for (let i = 0; i < batch.length; i += 1) if (!used.has(i)) missing.push(batch[i]);
    } catch (error) {
      missing.push(...batch);
      return { produced, missing, failure: `一批 ${batch.length} 章命名失败：${describeTitleError(error)}` };
    } finally {
      done += batch.length;
      options.onProgress?.(Math.min(done, candidates.length), candidates.length);
    }
    // 批量回包没配上的章节逐章补一次：几百 token 一章的小请求，比让作者自己挨章补名划算
    const retried = await retrySingles(singleFallbackClient, missing, options);
    const failure = retried.missing.length ? `${labelList(retried.missing)} 模型没给出可用标题，可以再说一次只处理这几章` : "";
    return { produced: [...produced, ...retried.entries], missing: retried.missing, failure };
  });

  let named = 0;
  const stillMissing: ChapterTitleCandidate[] = [];
  for (const result of batchResults) {
    entries.push(...result.produced);
    named += result.produced.length;
    stillMissing.push(...result.missing);
    if (result.failure) failures.push(result.failure);
  }
  // 批内重试只处理本批配不上的；整批异常（网络/JSON 挂掉）在上面 catch 里跳过了单章重试，这里统一再救一次
  if (stillMissing.length) {
    const rescued = await retrySingles(singleFallbackClient, stillMissing, options);
    entries.push(...rescued.entries);
    named += rescued.entries.length;
    if (rescued.missing.length) failures.push(`${labelList(rescued.missing)} 模型没给出可用标题，可以再说一次只处理这几章`);
  }
  return { entries, recovered, named, failures };
}

/** 命名失败时给一句能照着做的话，而不是只丢一句“网络错误” */
function describeTitleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/JSON|Unexpected token/iu.test(message)) return `${message}（模型没按 JSON 返回，重跑一次通常就好）`;
  return message;
}
