export function countNovelCharacters(content: string): number {
  return [...content.replace(/[\s\u200B-\u200D\uFEFF]/gu, '')].length;
}

/** 模型写在正文开头的章节标题行，以及剥掉标题行之后的纯正文 */
export interface ChapterDraftHeading {
  title: string;
  content: string;
}

/** 新建章节时自动生成的编号占位标题，作者还没给这一章起名 */
const numberedPlaceholderTitle = /^第\s*[\d零一二三四五六七八九十百千两]+\s*[章回节]$/u;
/** 连章号都没有的占位标题 */
const blankPlaceholderTitle = /^(?:新章节|未命名章节|无标题)$/u;
/** 标题名前的章号前缀：模型经常把章号数错，章号一律以应用自己的编号为准 */
const chapterNumberPrefix = /^第\s*[\d零一二三四五六七八九十百千两]+\s*[章回节]\s*[：:·、.\-—]?\s*/u;

/** 这一章还没有真正的名字，只有创建时的编号占位；批量补标题就是按它挑章节 */
export const isPlaceholderChapterTitle = (value: string): boolean => {
  const current = value.trim();
  return !current || numberedPlaceholderTitle.test(current) || blankPlaceholderTitle.test(current);
};

/**
 * 模型给的标题名里常带的多余包装：书名号、引号、句末标点
 * “《夜雨敲窗》。”这种套层要反复剥：单轮只能去掉最外一层
 */
export const cleanChapterTitleName = (value: string): string => {
  let name = value.trim().split(/\n/u)[0].trim();
  for (let round = 0; round < 4; round += 1) {
    const stripped = name
      .replace(/^[《【["'“‘（(]+/u, '')
      .replace(/[》】\]"'”’）)]+$/u, '')
      .replace(/[。！？…、；，!?]+$/u, '')
      .trim();
    if (stripped === name) break;
    name = stripped;
  }
  return name.slice(0, 60);
};

/**
 * 章节标题属于标题栏，不属于正文：把模型补在正文开头的 # 标题行拆出来
 * 标题不能直接丢掉——它是模型唯一给出章节名的地方，丢了标题栏就只剩“第 N 章”占位
 * 模型偶尔连写多行重复标题，最多剥 3 行；标题只取第一行，其余重复行丢掉
 */
export const splitChapterTitleHeading = (value: string): ChapterDraftHeading => {
  let content = value.trim();
  let title = '';
  for (let round = 0; round < 3; round += 1) {
    const match = /^#{1,3}\s*([^\n]{1,40})\n+/u.exec(content);
    if (!match) break;
    const titleLine = match[1].trim();
    // 只有看起来像章节名才剥（含“第 x 章”或较短且无标点的标题）；避免误伤正文里合法的 Markdown 小节
    const looksLikeChapterTitle = /第[\s\d零一二三四五六七八九十百千两]+章/u.test(titleLine)
      || (titleLine.length > 0 && !/[，。！？；：、“”…—]/u.test(titleLine) && titleLine.length <= 20);
    const rest = content.slice(match[0].length).trim();
    if (!looksLikeChapterTitle || !rest) break;
    if (!title) title = titleLine;
    content = rest;
  }
  return { title, content };
};

/**
 * 用模型写的标题行补全章节标题
 * 作者已经起过名的章节保持原样；只有占位标题才补，且沿用应用自己的章号
 */
export const applyDraftChapterTitle = (currentTitle: string, draftHeading: string): string => {
  const name = draftHeading.trim().replace(chapterNumberPrefix, '').trim();
  if (!name) return currentTitle;
  const current = currentTitle.trim();
  if (numberedPlaceholderTitle.test(current)) return `${current} ${name}`;
  if (!current || blankPlaceholderTitle.test(current)) return name;
  return currentTitle;
};
