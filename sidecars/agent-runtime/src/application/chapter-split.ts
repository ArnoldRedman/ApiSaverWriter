import type { ModelApiClient } from "../models/model-api.js";
import { generateChapterTitles } from "./chapter-titles.js";
import { mapWithConcurrency } from "./concurrency.js";

/** 一个切点最少要留多少字，避免切出几十字的碎片章 */
const MIN_PART_CHARACTERS = 400;
/** 一章最多切成几段：再多说明目标字数填得不合理，与其切碎不如报错 */
const MAX_PARTS = 12;
/** 同时给几章命名：拆章本身不花调用，只有新段落的标题要问模型 */
const SPLIT_CONCURRENCY = 3;

export interface ChapterSplitSource {
  targetId: number;
  title: string;
  content: string;
}

export interface ChapterSplitPlan {
  targetId: number;
  paragraphCount: number;
  breakAfter: number[];
  titles: string[];
}

export interface ChapterSplitResult {
  splits: ChapterSplitPlan[];
  failures: string[];
}

/** 正文按空行分段：拆章只能落在段落边界上，绝不在句子中间断开 */
export function splitParagraphs(content: string): string[] {
  return content.replace(/\r\n/gu, "\n").split(/\n\s*\n/u).map(item => item.trim()).filter(Boolean);
}

const characterCount = (value: string): number => value.replace(/\s/gu, "").length;

/**
 * 算出把一章切到目标字数需要在哪些段落之后断开
 * 纯文本计算，不调模型：正文一个字都不会被改写，只是换个地方分段。
 * 贪心累加段落，越过目标字数就断，并保证最后一段不至于太短。
 */
export function planChapterBreaks(paragraphs: string[], targetCharacters: number): number[] {
  const total = paragraphs.reduce((sum, item) => sum + characterCount(item), 0);
  const target = Math.max(MIN_PART_CHARACTERS, targetCharacters);
  if (paragraphs.length < 2 || total <= target * 1.35) {
    return [];
  }
  const breaks: number[] = [];
  let used = 0;
  for (let index = 0; index < paragraphs.length - 1; index += 1) {
    used += characterCount(paragraphs[index]);
    if (used < target) {
      continue;
    }
    // 剩下的不够独立成章就别断了，否则最后会留一个几百字的尾巴
    const rest = paragraphs.slice(index + 1).reduce((sum, item) => sum + characterCount(item), 0);
    if (rest < MIN_PART_CHARACTERS) {
      break;
    }
    breaks.push(index + 1);
    used = 0;
    if (breaks.length >= MAX_PARTS - 1) {
      break;
    }
  }
  return breaks;
}

/** 按切点把段落还原成各段正文，用于给模型命名和给作者预览 */
export function partsFromBreaks(paragraphs: string[], breakAfter: number[]): string[] {
  const bounds = [0, ...breakAfter, paragraphs.length];
  const parts: string[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    parts.push(paragraphs.slice(bounds[index], bounds[index + 1]).join("\n\n"));
  }
  return parts;
}

/** 原章标题里的“第 N 章”前缀，拆出来的后续段落继续沿用它的编号体系由应用决定，这里只取标题名 */
function titleName(title: string): string {
  return title.replace(/^\s*第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章节回卷]\s*[：:、.．·\-—]?\s*/u, "").trim();
}

/**
 * 规划整批拆章
 * 切点是纯文本算的，只有新段落的标题需要模型；命名失败不影响拆分本身，退回“原标题（二）”这种序号名，
 * 作者要更好的名字随时可以再用批量补标题重拟一遍。
 */
export async function planChapterSplits(
  client: ModelApiClient,
  sources: ChapterSplitSource[],
  options: { targetWords: number; instruction?: string; projectTitle?: string; onProgress?: (done: number, total: number) => void } = { targetWords: 2400 },
): Promise<ChapterSplitResult> {
  const failures: string[] = [];
  const planned: Array<{ source: ChapterSplitSource; paragraphs: string[]; breakAfter: number[]; parts: string[] }> = [];

  for (const source of sources) {
    const paragraphs = splitParagraphs(source.content || "");
    if (paragraphs.length < 2) {
      failures.push(`《${source.title || source.targetId}》整章没有分段，无法在段落边界上拆分`);
      continue;
    }
    const breakAfter = planChapterBreaks(paragraphs, options.targetWords);
    if (!breakAfter.length) {
      failures.push(`《${source.title || source.targetId}》只有 ${paragraphs.reduce((sum, item) => sum + characterCount(item), 0)} 字，没到需要拆分的长度`);
      continue;
    }
    planned.push({ source, paragraphs, breakAfter, parts: partsFromBreaks(paragraphs, breakAfter) });
  }

  let done = 0;
  const splits = await mapWithConcurrency(planned, SPLIT_CONCURRENCY, async entry => {
    const base = titleName(entry.source.title) || "";
    // 只给切出来的段落命名，第一段沿用原章标题，作者的章号编排不会被打乱
    const named = await generateChapterTitles(client, entry.parts.slice(1).map((content, index) => ({
      targetId: index + 1,
      currentTitle: "",
      content,
    })), {
      instruction: options.instruction,
      projectTitle: options.projectTitle,
    }).catch(() => ({ entries: [] as Array<{ targetId: number; title: string }>, failures: [], recovered: 0, named: 0 }));
    const byIndex = new Map(named.entries.map(item => [item.targetId, item.title]));
    const titles = [
      entry.source.title || base || "第一段",
      ...entry.parts.slice(1).map((_, index) => byIndex.get(index + 1) || `${base || entry.source.title || "续"}（${index + 2}）`),
    ];
    done += 1;
    options.onProgress?.(done, planned.length);
    return { targetId: entry.source.targetId, paragraphCount: entry.paragraphs.length, breakAfter: entry.breakAfter, titles };
  });

  return { splits, failures };
}
