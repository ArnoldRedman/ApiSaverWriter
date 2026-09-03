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
const TITLE_BATCH_CONCURRENCY = 3;

const titleSystemPrompt = `你是中文长篇网文的责任编辑，正在为已经写好的章节补标题。

要求：
1. 每个标题只概括该章真正发生的事，不得使用别章的情节，不得凭空发明设定。
2. 4 到 14 个汉字，不带“第几章”前缀，不带书名号、引号、句号和省略号。
3. 同一批里的标题必须互不相同，不要都写成“危机”“转机”这类空词。
4. 严格返回 JSON 对象：{"titles":[{"id":章节id,"title":"标题"}]}，不要代码围栏，不要解释。
5. 给了几章就返回几条，id 必须原样抄回，不要新增或漏掉章节。`;

/** 正文摘录：开头交代场景、结尾交代钩子，标题基本只靠这两段就能定 */
function titleExcerpt(content: string): string {
  const text = content.trim().replace(/\s*\n\s*\n\s*/gu, "\n");
  if (text.length <= 900) return text;
  return `${text.slice(0, 620)}\n……\n${text.slice(-260)}`;
}

/**
 * 批量补章节标题
 * 分两段走：先把旧版本遗留在正文开头的 # 标题行直接捡回来（零模型调用），
 * 剩下真的没有名字的章节才分批交给模型命名。
 * 一批失败只丢这一批并如实报出来，其余章节照常返回。
 */
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

  const batchResults = await mapWithConcurrency(batches, TITLE_BATCH_CONCURRENCY, async batch => {
    const listing = batch
      .map(item => `### id=${item.targetId}（当前：${item.currentTitle.trim() || "无标题"}）\n${titleExcerpt(item.content)}`)
      .join("\n\n");
    try {
      const response = await client.chat([
        { role: "system", content: titleSystemPrompt },
        { role: "user", content: `《${options.projectTitle || "未命名小说"}》需要补标题的章节共 ${batch.length} 章。${extra}\n\n${listing}` },
      ], { response_format: { type: "json_object" }, temperature: 0.5, max_tokens: 1200, retryAttempts: 3 });
      const cleaned = response.content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
      const parsed = JSON.parse(cleaned) as { titles?: unknown };
      const rows = Array.isArray(parsed.titles) ? parsed.titles : [];
      const byId = new Map(batch.map(item => [String(item.targetId), item]));
      const produced: ChapterTitleEntry[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const record = row as Record<string, unknown>;
        const candidate = byId.get(String(record.id ?? record.targetId ?? ""));
        const name = typeof record.title === "string" ? record.title : "";
        if (!candidate || !name.trim()) continue;
        const title = applyDraftChapterTitle(candidate.currentTitle, name);
        if (title.trim() === candidate.currentTitle.trim()) continue;
        produced.push({ targetId: candidate.targetId, title: title.slice(0, 160) });
      }
      const missing = batch.length - produced.length;
      return {
        produced,
        failure: missing > 0 ? `有 ${missing} 章模型没给出可用标题，可以再说一次只处理这几章` : "",
      };
    } catch (error) {
      return { produced: [], failure: `一批 ${batch.length} 章命名失败：${describeTitleError(error)}` };
    } finally {
      done += batch.length;
      options.onProgress?.(Math.min(done, candidates.length), candidates.length);
    }
  });

  let named = 0;
  for (const result of batchResults) {
    entries.push(...result.produced);
    named += result.produced.length;
    if (result.failure) failures.push(result.failure);
  }
  return { entries, recovered, named, failures };
}

/** 命名失败时给一句能照着做的话，而不是只丢一句“网络错误” */
function describeTitleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/JSON|Unexpected token/iu.test(message)) return `${message}（模型没按 JSON 返回，重跑一次通常就好）`;
  return message;
}
