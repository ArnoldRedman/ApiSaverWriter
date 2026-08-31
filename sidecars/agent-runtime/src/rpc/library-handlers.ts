import { compactText, contextBudgetBytes } from "../context/context-optimizer.js";
import { createModelApiClient, stringList } from "../application/model-client.js";
import {
  qianyueSources, webBookSources, searchQianyueSource, searchConfiguredBookSource, searchFanqieSource,
  searchAllBookSources, fetchNovelCatchRankingCategories, fetchQidianRanking, fetchFalooRanking,
  fetchNovelCatchRanking, downloadFanqieChapter, downloadFallbackChapter, downloadQianyueChapter,
  downloadConfiguredBookChapter, downloadQianyueSource, downloadConfiguredBookSource, downloadFanqieBook,
} from "../sources/library-service.js";
import type { RpcRegistry } from "./registry.js";

export const registerLibraryHandlers = (registry: RpcRegistry): RpcRegistry => registry
  .register("book.search", async params => {
    const { query, source } = params;
    if (!String(query || "").trim()) throw new Error("请输入书名或作者");
    const sourceId = String(source || "fanqie");
    const searchQuery = String(query).trim();
    if (sourceId.startsWith("qianyue-")) {
      const definition = qianyueSources.find(item => item.id === sourceId);
      if (!definition) throw new Error("未知千阅小说书源");
      return { books: await searchQianyueSource(definition, searchQuery, params), sourceId, sourceName: definition.name };
    }
    if (sourceId !== "fanqie") {
      const definition = webBookSources.find(item => item.id === sourceId);
      if (!definition) throw new Error("未知书源");
      return { books: await searchConfiguredBookSource(definition, searchQuery, params), sourceId, sourceName: definition.name };
    }
    const result = await searchFanqieSource(searchQuery, params);
    return { ...result, sourceId: "fanqie", sourceName: "番茄小说" };
  })
  .register("book.search.all", async params => {
    const query = String(params.query || "").trim();
    if (!query) throw new Error("请输入书名或作者");
    return await searchAllBookSources(query, params);
  })
  .register("book.sources.list", async params => {
    return { sources: [{ id: "fanqie", name: "番茄小说" }, ...qianyueSources.map(source => ({ id: source.id, name: source.name })), ...webBookSources.map(source => ({ id: source.id, name: source.name }))], defaultSourceId: "qianyue-kuwo" };
  })
  .register("ranking.categories", async params => {
    return { sections: await fetchNovelCatchRankingCategories(params) };
  })
  .register("ranking.fetch", async params => {
    const { platform, rankType, gender, rankUrl } = params;
    const selectedPlatform = String(platform || "fanqie");
    const type = String(rankType || "read");
    const selectedGender = String(gender || "all");
    if (selectedPlatform === "qidian") return { books: await fetchQidianRanking(type, selectedGender, params), fetchedAt: new Date().toISOString() };
    if (selectedPlatform === "faloo") return { books: await fetchFalooRanking(type, selectedGender, params), fetchedAt: new Date().toISOString() };
    if (selectedPlatform !== "fanqie") throw new Error("未知扫榜平台");
    const books = await fetchNovelCatchRanking(type, selectedGender, typeof rankUrl === "string" ? rankUrl : undefined, params);
    if (!books.length) throw new Error("NovelCatch 番茄官方榜单没有返回书籍，请稍后刷新");
    return { books: books.slice(0, 60), fetchedAt: new Date().toISOString(), sourceName: "番茄小说网" };
  })
  .register("book.chapter.download", async params => {
    const { source, sourceBookId, chapter } = params;
    const sourceId = String(source || "").trim();
    if (!sourceId) throw new Error("该书籍缺少书源信息，无法重试本章");
    if (!chapter || typeof chapter !== "object") throw new Error("缺少需要重新下载的章节");
    const currentChapter = chapter as Record<string, unknown>;
    if (sourceId === "fanqie") {
      const chapterId = String(currentChapter.url || "").match(/\/reader\/(\d+)/u)?.[1];
      if (!chapterId) throw new Error("该番茄章节缺少有效地址");
      const result = await downloadFanqieChapter({
        id: chapterId,
        title: String(currentChapter.title || "未命名章节"),
        url: String(currentChapter.url),
        locked: false,
      }, Number(currentChapter.number) || 1, String(sourceBookId || ""), params);
      if (result.downloaded === true) return { chapter: result };
      const fallback = await downloadFallbackChapter(
        String(params.bookTitle || ""),
        Number(currentChapter.number) || 1,
        String(currentChapter.title || ""),
        Number(result.expectedWords) || 0,
        params,
      );
      if (fallback) {
        return {
          chapter: {
            ...result,
            ...fallback,
            id: result.id,
            number: result.number,
            title: result.title,
            url: result.url,
            unavailableReason: undefined,
            downloaded: true,
          },
        };
      }
      return { chapter: result };
    }
    if (sourceId.startsWith("qianyue-")) {
      const definition = qianyueSources.find(item => item.id === sourceId);
      if (!definition) throw new Error("未知千阅小说书源");
      return { chapter: await downloadQianyueChapter(definition, currentChapter, params) };
    }
    const definition = webBookSources.find(item => item.id === sourceId);
    if (!definition) throw new Error("未知书源");
    return { chapter: await downloadConfiguredBookChapter(definition, currentChapter, params) };
  })
  .register("book.download", async params => {
    const { title, author, source, sourceBookId, url, maxChapters } = params;
    const sourceId = String(source || "fanqie");
    if (!String(url || "").trim()) throw new Error("缺少可下载的书籍地址");
    if (sourceId.startsWith("qianyue-")) {
      const definition = qianyueSources.find(item => item.id === sourceId);
      if (!definition) throw new Error("未知千阅小说书源");
      const chapters = await downloadQianyueSource(definition, String(url), params, Number(maxChapters) || Number.MAX_SAFE_INTEGER);
      return { title: String(title || "未命名书籍"), author: String(author || "未知作者"), sourceId, sourceName: definition.name, sourceBookId: String(sourceBookId || url), chapters };
    }
    if (sourceId !== "fanqie") {
      const definition = webBookSources.find(item => item.id === sourceId);
      if (!definition) throw new Error("未知书源");
      const chapters = await downloadConfiguredBookSource(definition, String(url), params, Number(maxChapters) || Number.MAX_SAFE_INTEGER);
      return { title: String(title || "未命名书籍"), author: String(author || "未知作者"), sourceId, sourceName: definition.name, sourceBookId: String(sourceBookId || url), chapters };
    }
    const chapters = await downloadFanqieBook(String(url), String(sourceBookId || ""), params, Number(maxChapters) || Number.MAX_SAFE_INTEGER);
    const downloadedChapterCount = chapters.filter(chapter => String(chapter.content || "").trim()).length;
    if (!downloadedChapterCount) throw new Error("番茄正文没有返回有效内容，未保存空章节；请稍后重试或导入 TXT");
    const completedChapterCount = chapters.filter(chapter => chapter.downloaded === true).length;
    return { title: String(title || "未命名书籍"), author: String(author || "未知作者"), sourceBookId: String(sourceBookId || ""), chapters, downloadedChapterCount, completedChapterCount };
  })
  .register("ranking.analyze", async params => {
    const { books, platform, rankType, gender, contextWindow } = params;
    if (!Array.isArray(books) || books.length === 0) throw new Error("缺少榜单样本或模型配置");
    const client = createModelApiClient(params, { model: "gpt-4o-mini" });
    const samples = books.slice(0, 60).map((item, index) => {
      const book = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return `${index + 1}. ${compactText(book.title || "未命名", 80)}｜${compactText(book.author || "未知", 40)}｜${compactText(book.category || "未分类", 40)}｜${compactText(book.intro || "", 260)}`;
    }).join("\n");
    const prompt = `你执行 story-long-scan 扫榜技能。根据${String(platform || "番茄小说")} ${String(gender || "全部频道")} ${String(rankType || "read")}榜样本，输出一份可供原创选题使用的市场盘点。\n\n要求：仅分析样本里可观察到的题材、标题、卖点、人物关系和开篇承诺；区分“样本证据”和“推断”；不建议复制具体作品、人名、世界观或桥段。\n\n使用以下 Markdown 结构：\n## 榜单概览\n## 高频题材与组合\n## 标题与开篇承诺\n## 读者爽点和冲突结构\n## 可验证的选题机会\n## 避免同质化的方向\n\n样本：\n${samples}`;
    const response = await client.chat([{ role: "user", content: prompt }], { temperature: 0.25, max_tokens: 1800, retryAttempts: 3 });
    return { report: response.content.trim() };
  })
  .register("book.dismantle", async params => {
    const { bookTitle, chapterTitle, chapterNumber, sourceContent, contextWindow } = params;
    if (!sourceContent) {
      throw new Error("缺少拆书分析所需的正文或模型配置");
    }
    const client = createModelApiClient(params, { model: "gpt-4o-mini" });
    const source = compactText(sourceContent, Math.min(contextBudgetBytes(Number(contextWindow) || undefined, 35, 18), 28_000));
    const prompt = `你是长篇小说结构分析编辑。请拆解《${String(bookTitle || "未命名作品")}》第 ${Number(chapterNumber) || 1} 章《${String(chapterTitle || "未命名章节")}》的剧情结构，生成可用于原创创作的细纲。

要求：只提炼抽象剧情结构、人物目标、冲突、信息揭示、伏笔和节奏；不得抄录原文句子，不得复述大段原文。章节细纲必须可执行，保留因果关系但不保留特定表达。

## 待分析正文
${source}

只返回 JSON：
{
  "summary":"180 字以内剧情摘要",
  "detailedOutline":"Markdown 章节细纲，包含：本章目标、承接状态、四段事件链、人物动机与对抗、信息与伏笔、节奏、结尾钩子",
  "plotBeats":["4-8 条事件节点"],
  "characterDynamics":["人物目标或关系变化"],
  "setupPayoff":["伏笔/回收"],
  "pacing":"开场/发展/转折/收束的节奏判断"
}`;
    const response = await client.chat([{ role: "user", content: prompt }], { response_format: { type: "json_object" }, temperature: 0.25, max_tokens: 2400, retryAttempts: 3 });
    try {
      const parsed = JSON.parse(response.content) as Record<string, unknown>;
      return {
        summary: String(parsed.summary || "").trim(),
        detailedOutline: String(parsed.detailedOutline || "").trim(),
        plotBeats: stringList(parsed.plotBeats, 10),
        characterDynamics: stringList(parsed.characterDynamics, 10),
        setupPayoff: stringList(parsed.setupPayoff, 10),
        pacing: String(parsed.pacing || "").trim(),
      };
    } catch {
      return { summary: "", detailedOutline: response.content.trim(), plotBeats: [], characterDynamics: [], setupPayoff: [], pacing: "" };
    }
  })
  .register("book.style.distill", async params => {
    const { bookTitle, styleName, samples, contextWindow } = params;
    if (!Array.isArray(samples) || samples.length === 0) {
      throw new Error("请选择至少一个章节用于蒸馏文风");
    }
    const client = createModelApiClient(params, { model: "gpt-4o-mini" });
    const sampleText = compactText(samples.map((sample, index) => {
      const item = sample && typeof sample === "object" ? sample as Record<string, unknown> : {};
      return `### 样本 ${index + 1}｜${String(item.title || "章节")}\n${String(item.content || "")}`;
    }).join("\n\n"), Math.min(contextBudgetBytes(Number(contextWindow) || undefined, 45, 24), 36_000));
    const prompt = `你是小说文风编辑。请从《${String(bookTitle || "参考作品")}》的节选中蒸馏一份可复用的“文风 Skill”。

只描述抽象、可执行的写作特征：叙述视角、句长与段落、动作和感官比例、对话节奏、情绪张力、场景切换、悬念收束、禁忌项。不要引用、改写或模仿可识别的原文句式；输出必须用于创作独立的新故事。

## 样本
${sampleText}

只返回 JSON：
{
  "name":"文风名称",
  "description":"一句话特征说明",
  "tags":["标签"],
  "content":"Markdown 文风 Skill，包含适用范围、写作指令、段落节奏、对话、感官、钩子、禁止项和自检清单"
}`;
    const response = await client.chat([{ role: "user", content: prompt }], { response_format: { type: "json_object" }, temperature: 0.3, max_tokens: 2200, retryAttempts: 3 });
    try {
      const parsed = JSON.parse(response.content) as Record<string, unknown>;
      return {
        name: String(parsed.name || styleName || "蒸馏文风").trim(),
        description: String(parsed.description || "从拆书章节提炼的原创写作约束。").trim(),
        tags: stringList(parsed.tags, 10),
        content: String(parsed.content || response.content).trim(),
      };
    } catch {
      return { name: String(styleName || "蒸馏文风"), description: "从拆书章节提炼的原创写作约束。", tags: ["蒸馏文风"], content: response.content.trim() };
    }
  })
  .register("book.rewrite", async params => {
    const { bookTitle, chapterTitle, detailedOutline, instruction, targetWords, contextWindow } = params;
    if (!detailedOutline) {
      throw new Error("请先生成并确认章节细纲");
    }
    const client = createModelApiClient(params, { model: "gpt-4o-mini" });
    const wordLimit = Math.max(600, Math.min(8000, Math.floor(Number(targetWords) || 2200)));
    const prompt = `你是原创网络小说作者。根据下面从《${String(bookTitle || "参考作品")}》抽象出的章节结构，写一份完全独立的新章节草稿。

不可使用原作品的人名、地名、专有设定、原句、独特措辞或可识别事件细节；请重构人物、场景、冲突解决方式与情节表面，保留的只能是一般性的戏剧功能。只输出正文，不加标题、注释或 Markdown。

目标章节：${String(chapterTitle || "原创章节")}
作者要求：${String(instruction || "保留节奏和冲突强度，写成独立故事。")}
目标长度：约 ${wordLimit} 个中文字符。

## 抽象细纲
${compactText(detailedOutline, 14_000)}`;
    const response = await client.chat([{ role: "user", content: prompt }], { temperature: 0.75, max_tokens: Math.min(9000, Math.ceil(wordLimit * 1.7)), retryAttempts: 3 });
    return { content: response.content.trim().replace(/^```(?:markdown|text)?\s*/i, "").replace(/```$/u, "").trim() };
  })
  .register("book.adapt", async params => {
    const { projectTitle, projectSynopsis, projectOutlines, chapterTitle, detailedOutline, rewriteContent, styleProfile, contextWindow } = params;
    if ((!detailedOutline && !rewriteContent)) {
      throw new Error("请先准备章节细纲或原创改写稿");
    }
    const client = createModelApiClient(params, { model: "gpt-4o-mini" });
    const prompt = `你是《${String(projectTitle || "未命名小说")}》的章节作者。把下列原创章节素材转换成符合目标小说设定的可编辑正文。

只使用目标小说的人物、世界观和大纲；如果素材与设定冲突，以目标设定为准并重构。必须写成独立原创内容，不复用参考作品的专名、句子和可识别桥段。只输出章节正文，不加标题。

## 目标作品简介
${String(projectSynopsis || "暂无")}

## 目标作品大纲
${compactText(projectOutlines, 7000)}

${styleProfile ? `## 已绑定文风 Skill\n${compactText(styleProfile, 6000)}\n` : ""}
## 章节素材｜${String(chapterTitle || "新章节")}
${compactText(rewriteContent || detailedOutline, 14_000)}`;
    const response = await client.chat([{ role: "user", content: prompt }], { temperature: 0.72, max_tokens: 7000, retryAttempts: 3 });
    return { title: String(chapterTitle || "新章节"), content: response.content.trim().replace(/^```(?:markdown|text)?\s*/i, "").replace(/```$/u, "").trim() };
  });
