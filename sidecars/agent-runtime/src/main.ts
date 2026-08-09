#!/usr/bin/env node
import { createChapterGraph } from "./graphs/chapter-write.graph.js";
import { StoryStore } from "./storage/story-store.js";
import { ApiSaverClient } from "./models/api-saver.js";
import { StreamEmitter } from "./streaming/stream-handler.js";
import { byteLength, compactKnowledgeGraph, compactText, contextBudgetBytes, LruCache, prepareChapterInput, stableHash, type ContextReport, type PreparedChapterInput } from "./context/context-optimizer.js";

interface RPCRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface RPCResponse {
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

// The desktop process keeps this runtime alive. These caches therefore survive
// normal editor actions without persisting any novel material outside memory.
const chapterPreparationCache = new LruCache<PreparedChapterInput>(48);
const chapterMemoryCache = new LruCache<Record<string, unknown>>(96);

const memoryEditorSystemPrompt = `你是长篇小说的记忆编辑。只从章节正文与给定的相关资料抽取明确事实，不补写未发生的剧情。

输出必须是严格 JSON 对象，不要代码围栏或解释。摘要应简短、可检索、包含事件推进、人物状态和未解决线索。实体与关系必须有正文依据；卡片只在状态确有变化且正文能证明时更新。`;

const stringList = (value: unknown, limit = 20): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean).slice(0, limit)
  : [];

const networkProxyConfig = (params?: Record<string, unknown>) => ({
  proxyEnabled: Boolean(params?.proxyEnabled),
  proxyURL: typeof params?.proxyURL === "string" ? params.proxyURL : "",
  proxyBypassLocal: params?.proxyBypassLocal === true,
});

const memoryTypeForDocument = (kind: string): "event" | "character_state" | "canon_fact" | "foreshadowing" | "timeline" => {
  if (kind === "人物状态" || kind === "角色认知") return "character_state";
  if (kind === "伏笔追踪") return "foreshadowing";
  if (kind === "时间线") return "timeline";
  if (kind === "设定事实" || kind === "冲突") return "canon_fact";
  return "event";
};

const normalizeMemoryResult = (content: string): Record<string, unknown> => {
  try {
    const cleanedResponse = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/u, "").trim();
    const result = JSON.parse(cleanedResponse) as Record<string, unknown>;
    return {
      summary: typeof result.summary === "string" ? result.summary : content,
      keywords: stringList(result.keywords, 8),
      characterStateChanges: stringList(result.characterStateChanges),
      knowledgeChanges: stringList(result.knowledgeChanges),
      foreshadowingChanges: stringList(result.foreshadowingChanges),
      timelineEvents: stringList(result.timelineEvents),
      canonFacts: stringList(result.canonFacts),
      conflicts: stringList(result.conflicts),
      endingHook: typeof result.endingHook === "string" ? String(result.endingHook).trim() : "",
      entities: Array.isArray(result.entities) ? (result.entities as unknown[]).filter(item => item && typeof item === "object").slice(0, 30).map((item: unknown) => {
        const entity = item as Record<string, unknown>;
        return { name: String(entity.name || "").trim(), type: String(entity.type || "实体").trim() };
      }).filter(item => item.name) : [],
      relations: Array.isArray(result.relations) ? (result.relations as unknown[]).filter(item => item && typeof item === "object").slice(0, 60).map((item: unknown) => {
        const relation = item as Record<string, unknown>;
        return { source: String(relation.source || "").trim(), target: String(relation.target || "").trim(), label: String(relation.label || "关联").trim() };
      }).filter(item => item.source && item.target) : [],
      cardUpdates: Array.isArray(result.cardUpdates) ? (result.cardUpdates as unknown[]).filter(item => item && typeof item === "object").slice(0, 30).map((item: unknown) => {
        const update = item as Record<string, unknown>;
        return { cardId: typeof update.cardId === "number" || typeof update.cardId === "string" ? update.cardId : undefined, cardTitle: String(update.cardTitle || "").trim(), status: String(update.status || "updated").trim(), changes: String(update.changes || "").trim() };
      }).filter(item => item.cardTitle || item.cardId !== undefined) : [],
    };
  } catch {
    return {
      summary: content.slice(0, 220), keywords: [], characterStateChanges: [], knowledgeChanges: [],
      foreshadowingChanges: [], timelineEvents: [], canonFacts: [], conflicts: [], endingHook: "", entities: [], relations: [], cardUpdates: [],
    };
  }
};

async function handleRequest(req: RPCRequest): Promise<RPCResponse> {
  try {
    if (req.method === "models.list") {
      const { apiKey, apiKeys, baseURL, apiMode, reasoningMode, contextWindow, proxyEnabled, proxyURL, proxyBypassLocal } = req.params ?? {};
      if (!apiKey) {
        return { id: req.id, error: { code: -32602, message: "Missing required params" } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        proxyEnabled: Boolean(proxyEnabled),
        proxyURL: String(proxyURL || ""),
        proxyBypassLocal: proxyBypassLocal === true,
      });
      return { id: req.id, result: { models: await client.listModels() } };
    }
    if (req.method === "models.test") {
      const { apiKey, apiKeys, baseURL, model, apiMode, reasoningMode, contextWindow } = req.params ?? {};
      if (!apiKey || !model) {
        return { id: req.id, error: { code: -32602, message: "缺少测试模型所需参数" } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        defaultModel: String(model),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        ...networkProxyConfig(req.params),
      });
      await client.chat([{ role: "user", content: "请只回复 OK" }], { max_tokens: 8, temperature: 0, retryAttempts: 2 });
      return { id: req.id, result: { tested: true, model: String(model) } };
    }
    if (req.method === "project.generate") {
      const { field, source, title, synopsis, channel, tags, protagonist1, protagonist2, outlines, chapters, apiKey, apiKeys, baseURL, model, apiMode, reasoningMode, contextWindow } = req.params ?? {};
      if (!apiKey || (field !== "title" && field !== "synopsis")) {
        return { id: req.id, error: { code: -32602, message: "缺少生成作品信息所需参数" } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        defaultModel: String(model || "gpt-4o-mini"),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        ...networkProxyConfig(req.params),
      });
      const tagRecord = tags && typeof tags === "object" ? tags as Record<string, unknown> : {};
      const tagText = Object.entries(tagRecord).flatMap(([kind, values]) => stringList(values).map(value => `${kind}：${value}`)).join("；");
      const outlineContext = Array.isArray(outlines) && outlines.length
        ? outlines.map(item => {
          const outline = item as Record<string, unknown>;
          return `### ${String(outline.kind || "大纲")}｜${String(outline.title || "未命名")}\n${String(outline.content || "").slice(0, 5000)}`;
        }).join("\n\n")
        : "（暂无可用大纲，请根据已有作品信息构思）";
      const chapterContext = Array.isArray(chapters) && chapters.length
        ? chapters.map(item => {
          const chapter = item as Record<string, unknown>;
          return `### ${String(chapter.title || "章节")}\n${String(chapter.content || "").slice(0, 4500)}`;
        }).join("\n\n")
        : "（暂无可用章节，请根据已有作品信息构思）";
      const selectedContext = source === "chapters" ? chapterContext : outlineContext;
      const common = `频道：${String(channel || "男频")}\n标签：${tagText || "暂无"}\n主角：${[protagonist1, protagonist2].filter(Boolean).map(String).join("、") || "暂无"}\n当前书名：${String(title || "暂无")}\n已有作品简介：${String(synopsis || "暂无")}\n\n## ${source === "chapters" ? "前 3 章正文" : "作品大纲"}\n${selectedContext}`;
      const prompt = field === "title"
        ? `你是番茄小说平台的网文责编。请根据下列素材拟定一个适合${String(channel || "男频")}读者、具备题材卖点和记忆点的中文网文书名。\n\n${common}\n\n只返回 JSON：\n{ "title": "书名" }\n\n规则：书名 4 到 15 个汉字或常用数字；不要加《》、引号、作者名、解释、标点或副标题；避免与素材无关的套路词。`
        : `你是番茄小说平台的网文责编。请根据下列素材撰写可直接用于上架页的作品简介。\n\n${common}\n\n只返回 JSON：\n{ "synopsis": "作品简介" }\n\n规则：180 到 320 个中文字符，最多 500 字；开头迅速给出主角处境、核心金手指或矛盾，中段明确升级目标与风险，结尾留下强钩子；突出标签卖点和读者预期；不加标题、Markdown、分段序号、免责声明或解释；不得编造与素材矛盾的事实。`;
      const response = await client.chat([{ role: "user", content: prompt }], {
        response_format: { type: "json_object" },
        temperature: field === "title" ? 0.9 : 0.7,
        max_tokens: field === "title" ? 180 : 900,
        retryAttempts: 2,
      });
      try {
        const cleanedResponse = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/u, "").trim();
        const result = JSON.parse(cleanedResponse) as Record<string, any>;
        return {
          id: req.id,
          result: {
            title: typeof result.title === "string" ? result.title.trim() : "",
            synopsis: typeof result.synopsis === "string" ? result.synopsis.trim() : "",
          },
        };
      } catch {
        const content = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/u, "").trim();
        return { id: req.id, result: field === "title" ? { title: content } : { synopsis: content } };
      }
    }
    if (req.method === "skill.write") {
      const { name, category, description, content, tags, apiKey, apiKeys, baseURL, model, apiMode, reasoningMode, contextWindow } = req.params ?? {};
      if (!apiKey || (!name && !description && !content)) {
        return { id: req.id, error: { code: -32602, message: "缺少创建技能所需参数" } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        defaultModel: String(model || "gpt-4o-mini"),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        ...networkProxyConfig(req.params),
      });
      const prompt = `你是 skill-creator。请把用户的小说写作需求整理成一个可复用技能。\n\n名称：${String(name || "待命名技能")}\n分类：${String(category || "write")}\n用途：${String(description || "暂无")}\n草稿：${String(content || "暂无")}\n标签：${stringList(tags).join("、") || "暂无"}\n\n只返回 JSON：\n{\n  "name": "短名称（英文 kebab-case）",\n  "category": "setup|write|review|polish|import|analyze|tool|creator",\n  "description": "一句话用途",\n  "tags": ["标签"],\n  "content": "Markdown 技能正文，包含触发条件、输入、步骤、输出格式、质量检查和失败处理"\n}\n不要输出 JSON 以外的文字。`;
      const response = await client.chat([{ role: "user", content: prompt }], { response_format: { type: "json_object" }, temperature: 0.3, max_tokens: 2200 });
      try {
        const result = JSON.parse(response.content) as Record<string, unknown>;
        return { id: req.id, result: {
          name: typeof result.name === "string" ? result.name.trim() : String(name || "custom-skill"),
          category: typeof result.category === "string" ? result.category.trim() : String(category || "write"),
          description: typeof result.description === "string" ? result.description.trim() : String(description || ""),
          content: typeof result.content === "string" ? result.content.trim() : response.content,
          tags: stringList(result.tags, 12),
        } };
      } catch {
        return { id: req.id, result: { name: String(name || "custom-skill"), category: String(category || "write"), description: String(description || ""), content: response.content, tags: stringList(tags, 12) } };
      }
    }
    if (req.method === "memory.write") {
      const { projectTitle, chapterTitle, content, cards, knowledgeGraph, apiKey, apiKeys, baseURL, model, apiMode, reasoningMode, contextWindow } = req.params ?? {};
      if (!chapterTitle || !content || !apiKey) {
        return { id: req.id, error: { code: -32602, message: "Missing required params" } };
      }
      const memoryBudgetBytes = contextBudgetBytes(Number(contextWindow) || undefined, 20, 8);
      const chapterContent = compactText(content, memoryBudgetBytes);
      const rawCards = Array.isArray(cards) ? cards.filter(card => card && typeof card === "object") as Array<Record<string, unknown>> : [];
      // A card that is neither named in this chapter nor selected by graph context cannot change here.
      const relevantCards = rawCards.filter(card => {
        const title = String(card.title || "").trim();
        return title.length > 0 && String(content).includes(title);
      }).slice(0, 10);
      const graphSummary = compactKnowledgeGraph(
        knowledgeGraph,
        `${String(chapterTitle)}\n${chapterContent}\n${relevantCards.map(card => String(card.title || "")).join(" ")}`,
        2400,
      );
      const memoryCacheKey = stableHash({
        projectTitle: String(projectTitle || ""), chapterTitle: String(chapterTitle), content: String(content),
        cards: relevantCards.map(card => ({ id: card.id, title: card.title, state: card.currentState, updatedAt: card.updatedAt })),
        graphSummary, model: String(model || "gpt-5.5"), apiMode: String(apiMode || "openai"),
      });
      const cachedMemory = chapterMemoryCache.get(memoryCacheKey);
      if (cachedMemory) {
        const cachedReport: ContextReport = {
          cache: "hit",
          sourceBytes: byteLength(JSON.stringify({ content, cards: rawCards, knowledgeGraph })),
          packedBytes: byteLength(chapterContent) + byteLength(graphSummary),
          prunedBytes: Math.max(0, byteLength(JSON.stringify({ content, cards: rawCards, knowledgeGraph })) - byteLength(chapterContent) - byteLength(graphSummary)),
          budgetBytes: memoryBudgetBytes,
          sections: { chapter: byteLength(chapterContent), cards: 0, knowledgeGraph: byteLength(graphSummary) },
        };
        return { id: req.id, result: { ...cachedMemory, contextReport: cachedReport } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        defaultModel: String(model || "gpt-5.5"),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        ...networkProxyConfig(req.params),
      });
      const cardContext = Array.isArray(cards) && cards.length
        ? `\n## 已有卡片及当前状态（仅更新正文有证据的卡片）\n${cards.map(card => { const item = card as Record<string, unknown>; return `${String(item.id || "")}|${String(item.title || "卡片")}：${String(item.content || "")}\n当前状态：${String(item.currentState || "暂无")}`; }).join("\n")}`
        : "";
      const graphContext = knowledgeGraph && typeof knowledgeGraph === "object"
        ? `\n## 已有知识图谱（用于增量更新）\n${JSON.stringify(knowledgeGraph).slice(0, 12000)}`
        : "";
      const compactCardContext = relevantCards.length
        ? `\n## 正文命中的卡片（仅可更新这些卡片）\n${relevantCards.map(card => {
          const history = Array.isArray(card.stateHistory) ? card.stateHistory.slice(-2).map(item => {
            const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
            return compactText(entry.changes || "", 180);
          }).filter(Boolean).join("；") : "";
          return `${String(card.id || "")} | ${compactText(card.title || "卡片", 100)}\n当前状态：${compactText(card.currentState || "暂无", 360)}${history ? `\n近期变化：${history}` : ""}\n知识：${compactText(card.content || "", 720)}`;
        }).join("\n\n")}`
        : "";
      const compactGraphContext = graphSummary ? `\n## 相关知识图谱（用于增量更新）\n${graphSummary}` : "";
      const compactMemoryPrompt = `请为《${String(projectTitle || "未命名小说")}》的${String(chapterTitle)}整理可检索的结构化章节记忆，并从正文抽取有证据的实体、关系和卡片变化。

## 本章正文
${chapterContent}${compactCardContext}${compactGraphContext}

返回 JSON：
{
  "summary": "180 字以内的事件、人物状态和未解决线索",
  "keywords": ["最多 8 个关键词"],
  "characterStateChanges": ["角色名：持续状态变化"],
  "knowledgeChanges": ["角色名：得知或隐瞒的信息"],
  "foreshadowingChanges": ["伏笔进展"],
  "timelineEvents": ["可排序事件"],
  "canonFacts": ["后续必须遵守的事实"],
  "conflicts": ["冲突和结果"],
  "endingHook": "章末未解决事项",
  "entities": [{"name":"实体","type":"人物|物品|地点|势力|事件|设定"}],
  "relations": [{"source":"实体","target":"实体","label":"关系"}],
  "cardUpdates": [{"cardId":"卡片 ID","cardTitle":"卡片名称","status":"changed|acquired|lost|revealed|updated","changes":"有正文依据的变化"}]
}

实体不超过 30 个，关系不超过 60 条；无内容使用空数组或空字符串。`;
      const optimizedResponse = await client.chat([
        { role: "system", content: memoryEditorSystemPrompt },
        { role: "user", content: compactMemoryPrompt },
      ], { response_format: { type: "json_object" }, temperature: 0.2, max_tokens: 1300, retryAttempts: 4 });
      const contextReport: ContextReport = {
        cache: "miss",
        sourceBytes: byteLength(JSON.stringify({ content, cards: rawCards, knowledgeGraph })),
        packedBytes: byteLength(chapterContent) + byteLength(compactCardContext) + byteLength(compactGraphContext),
        prunedBytes: Math.max(0, byteLength(JSON.stringify({ content, cards: rawCards, knowledgeGraph })) - byteLength(chapterContent) - byteLength(compactCardContext) - byteLength(compactGraphContext)),
        budgetBytes: memoryBudgetBytes,
        sections: { chapter: byteLength(chapterContent), cards: byteLength(compactCardContext), knowledgeGraph: byteLength(compactGraphContext) },
      };
      const memoryResult = normalizeMemoryResult(optimizedResponse.content);
      chapterMemoryCache.set(memoryCacheKey, memoryResult);
      return { id: req.id, result: { ...memoryResult, contextReport } };
    }
    if (req.method === "text.transform") {
      const { mode, instruction, content, previousChapter, maxWords, projectTitle, chapterTitle, apiKey, apiKeys, baseURL, model, apiMode, reasoningMode, contextWindow } = req.params ?? {};
      if (!apiKey || !content && !previousChapter) {
        return { id: req.id, error: { code: -32602, message: "缺少文本处理所需参数" } };
      }
      if (mode !== "polish" && mode !== "continue") {
        return { id: req.id, error: { code: -32602, message: "不支持的文本处理类型" } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        defaultModel: String(model || "gpt-4o-mini"),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        ...networkProxyConfig(req.params),
      });
      const extraRequirement = String(instruction || "").trim();
      const numericLimit = Math.max(1, Math.floor(Number(maxWords) || 0));
      const prompt = mode === "polish"
        ? `你是小说文字编辑。请润色以下《${String(projectTitle || "未命名小说")}》${String(chapterTitle || "当前章节")}中的文本。\n\n要求：保持原意、人物口吻、叙述视角和情节事实不变；优化表达、动作逻辑、可读性和画面感；不要新增剧情，不要解释，不要加标题或 Markdown 标记。${extraRequirement ? `\n作者额外要求：${extraRequirement}` : ""}\n\n待润色文本：\n${String(content)}`
        : `你是长篇网络小说作者。请为《${String(projectTitle || "未命名小说")}》的${String(chapterTitle || "当前章节")}续写一段可直接插入正文的内容。\n\n要求：只输出续写正文，不复述已有内容，不加标题、注释或 Markdown 标记；承接已有的叙事视角、人物状态、时间线和文风；推进一个明确动作或事件，并自然收束在可继续写作的位置；输出不得超过 ${numericLimit} 个非空白字符。${extraRequirement ? `\n作者续写要求：${extraRequirement}` : ""}\n\n上一章结尾（仅在当前章为空时优先承接）：\n${String(previousChapter || "无")}\n\n当前章节已有内容：\n${String(content || "（当前章为空，请承接上一章）")}`;
      const response = await client.chat([{ role: "user", content: prompt }], {
        temperature: mode === "polish" ? 0.35 : 0.75,
        max_tokens: mode === "continue" ? Math.min(7000, Math.max(500, Math.ceil(numericLimit * 1.6))) : 5000,
        retryAttempts: 2,
      });
      let result = response.content.trim().replace(/^```(?:markdown|text)?\s*/i, "").replace(/```$/u, "").trim();
      if (mode === "continue" && numericLimit > 0 && Array.from(result.replace(/\s/gu, "")).length > numericLimit) {
        const limited = Array.from(result).slice(0, numericLimit).join("");
        const ending = Math.max(limited.lastIndexOf("。"), limited.lastIndexOf("！"), limited.lastIndexOf("？"));
        result = (ending > numericLimit * 0.55 ? limited.slice(0, ending + 1) : limited).trim();
      }
      return { id: req.id, result: { content: result } };
    }
    if (req.method === "card.write") {
      const { projectTitle, synopsis, cardType, cardTitle, existingContent, chapterTitle, chapterContent, outlines, cards, apiKey, apiKeys, baseURL, model, apiMode, reasoningMode, contextWindow } = req.params ?? {};
      if (!projectTitle || !cardType || !apiKey) {
        return { id: req.id, error: { code: -32602, message: "缺少生成卡片所需参数" } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        defaultModel: String(model || "gpt-5.5"),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        ...networkProxyConfig(req.params),
      });
      const outlineContext = Array.isArray(outlines) && outlines.length
        ? `\n## 作品大纲片段\n${outlines.map(outline => { const item = outline as Record<string, unknown>; return `### ${String(item.kind || "大纲")}\n${String(item.content || "").slice(0, 3000)}`; }).join("\n\n")}`
        : "";
      const cardContext = Array.isArray(cards) && cards.length
        ? `\n## 已有卡片（用于避免重复）\n${cards.map(card => { const item = card as Record<string, unknown>; return `${String(item.title || "卡片")}：${String(item.content || "").slice(0, 600)}`; }).join("\n")}`
        : "";
      const chapterContext = chapterContent
        ? `\n## 当前章节片段（用于提取事实）\n${String(chapterTitle || "当前章节")}\n${String(chapterContent)}`
        : "";
      const prompt = `你是长篇小说的知识设定编辑。请为《${String(projectTitle)}》生成一张${String(cardType)}，供章节智能体长期检索。\n\n作品简介：${String(synopsis || "暂无")}${outlineContext}${chapterContext}${cardContext}\n\n${cardTitle ? `用户给出的卡片名称：${String(cardTitle)}` : "请根据上下文拟定一个准确、简洁的卡片名称。"}\n${existingContent ? `\n用户已有草稿，请在不违背正文事实的前提下补全：\n${String(existingContent)}` : ""}\n\n只返回 JSON：\n{\n  "title": "卡片名称",\n  "content": "详细 Markdown 内容"\n}\n\n内容请按卡片类型组织：角色卡写身份、性格、目标、能力、关系、当前状态和秘密；物品卡写来源、外观、能力、代价和持有者；地点卡写环境、势力、规则、资源和危险；势力卡写目标、组织结构、成员、资源和敌对关系；金手指卡写触发条件、能力、限制、升级路径和代价。只记录上下文能够支持的事实，未知部分明确标为待揭示。`;
      const response = await client.chat([{ role: "user", content: prompt }], { response_format: { type: "json_object" } });
      try {
        const result = JSON.parse(response.content) as Record<string, unknown>;
        return {
          id: req.id,
          result: {
            title: typeof result.title === "string" ? result.title.trim() : String(cardTitle || `${String(cardType)}设定`),
            content: typeof result.content === "string" ? result.content.trim() : response.content,
          },
        };
      } catch {
        return { id: req.id, result: { title: String(cardTitle || `${String(cardType)}设定`), content: response.content } };
      }
    }
    if (req.method === "outline.write") {
      const { projectTitle, kind, existingContent, synopsis, cards, knowledgeGraph, apiKey, apiKeys, baseURL, model, apiMode, reasoningMode, contextWindow } = req.params ?? {};
      if (!projectTitle || !kind || !apiKey) {
        return { id: req.id, error: { code: -32602, message: "Missing required params" } };
      }
      const client = new ApiSaverClient({
        apiKey: String(apiKey),
        apiKeys: stringList(apiKeys, 12),
        baseURL: String(baseURL || "https://api.apisaver.com/v1"),
        defaultModel: String(model || "gpt-4o-mini"),
        apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
        reasoningMode: String(reasoningMode || "auto"),
        contextWindowKB: Number(contextWindow) || undefined,
        ...networkProxyConfig(req.params),
      });
      const cardSection = Array.isArray(cards) && cards.length > 0
        ? `\n## 相关知识卡片\n${cards.map(card => { const item = card as Record<string, unknown>; return `### ${String(item.title || "卡片")}\n${String(item.content || "")}`; }).join("\n\n")}`
        : "";
      const graphSection = knowledgeGraph && typeof knowledgeGraph === "object"
        ? `\n## 知识图谱约束\n${JSON.stringify(knowledgeGraph).slice(0, 12000)}\n请保持已有实体和关系一致，新增关系标注为“待揭示”。`
        : "";
      const prompt = `你是长篇网络小说策划。请为《${String(projectTitle)}》编写一份${String(kind)}，供后续章节 Agent 使用。\n\n作品简介：${String(synopsis || "暂无")}\n\n现有内容：${String(existingContent || "暂无")}${cardSection}${graphSection}\n\n请输出 Markdown 文档，包含清晰的标题、分节、可执行的设定和剧情信息。不要输出解释性前言。`;
      const response = await client.chat([{ role: "user", content: prompt }]);
      return { id: req.id, result: { content: response.content } };
    }
    if (req.method === "chapter.write") {
      const {
        projectId,
        projectTitle,
        chapterId,
        instruction,
        outline,
        outlines,
        activeOutlineId,
        cards,
        previousChapters,
        memories,
        memoryDocuments,
        knowledgeGraph,
        apiKey,
        apiKeys,
        baseURL,
        model,
        apiMode,
        reasoningMode,
        contextWindow,
      } = req.params ?? {};
      if (!projectId || !chapterId || !instruction || !apiKey) {
        return { id: req.id, error: { code: -32602, message: "Missing required params" } };
      }
      const store = StoryStore.inMemory();
      const runId = typeof req.params?.runId === "string" ? req.params.runId : "";
      const streamEmitter = new StreamEmitter();
      streamEmitter.subscribe(event => {
        process.stdout.write(JSON.stringify({ type: "agent_stream", runId, event }) + "\n");
      });
      streamEmitter.progress("starting", 3, "运行环境已就绪，正在整理本章资料");
      const preparationKey = stableHash({
        projectId, chapterId, instruction, outline, outlines, activeOutlineId, cards,
        previousChapters, memories, memoryDocuments, knowledgeGraph, skills: req.params?.skills,
        contextWindow: Number(contextWindow) || 128,
      });
      const cachedPreparation = chapterPreparationCache.get(preparationKey);
      const prepared = cachedPreparation || prepareChapterInput({
        instruction: String(instruction), outline, outlines, activeOutlineId, cards, previousChapters,
        memories, memoryDocuments, knowledgeGraph, skills: req.params?.skills,
        contextWindowKB: Number(contextWindow) || undefined,
      });
      if (!cachedPreparation) chapterPreparationCache.set(preparationKey, prepared);
      const contextReport: ContextReport = {
        ...prepared.report,
        cache: cachedPreparation ? "hit" : "miss",
        sections: { ...prepared.report.sections },
      };
      streamEmitter.progress("starting", 6, `${cachedPreparation ? "上下文缓存命中" : "上下文缓存未命中"}；已将 ${Math.max(0, contextReport.prunedBytes / 1024).toFixed(1)} KB 无关资料移出本次请求`);
      try {
        const normalizedProjectId = String(projectId);
        store.createProject({ id: normalizedProjectId, title: String(projectTitle || "未命名小说") });
        const chapters = prepared.previousChapters;
        chapters.forEach((chapter, index) => {
          if (!chapter || typeof chapter !== "object") return;
          const item = chapter as Record<string, unknown>;
          const content = String(item.content || "").trim();
          if (!content) return;
          store.saveMemory({
            id: `chapter-memory-${String(item.id || index)}`,
            projectId: normalizedProjectId,
            type: "event",
            title: String(item.title || `第 ${index + 1} 章`),
            content: content.slice(-5000),
            entityNames: [],
            confirmed: true,
            importance: 0.55,
          });
        });
        const memoryItems = prepared.memories;
        memoryItems.forEach((memory, index) => {
          if (!memory || typeof memory !== "object") return;
          const item = memory as Record<string, unknown>;
          const entityNames = Array.isArray(item.keywords)
            ? item.keywords.filter((keyword): keyword is string => typeof keyword === "string")
            : [];
          const title = String(item.title || `章节记忆 ${index + 1}`);
          const save = (suffix: string, type: "event" | "character_state" | "canon_fact" | "foreshadowing" | "timeline", label: string, values: string[], importance: number) => {
            const content = values.join("\n").trim();
            if (!content) return;
            store.saveMemory({
              id: `saved-memory-${String(item.id || index)}-${suffix}`,
              projectId: normalizedProjectId,
              type,
              title: `${title} · ${label}`,
              content,
              entityNames,
              confirmed: true,
              importance,
            });
          };
          save("summary", "event", "章节摘要", [String(item.summary || "")], 0.82);
          save("character-state", "character_state", "人物状态", stringList(item.characterStateChanges), 1);
          save("knowledge", "character_state", "角色认知", stringList(item.knowledgeChanges), 0.98);
          save("foreshadowing", "foreshadowing", "伏笔追踪", stringList(item.foreshadowingChanges), 0.98);
          save("timeline", "timeline", "时间线", stringList(item.timelineEvents), 0.94);
          save("canon", "canon_fact", "设定事实", stringList(item.canonFacts), 0.96);
          save("conflict", "canon_fact", "冲突", stringList(item.conflicts), 0.92);
          save("hook", "foreshadowing", "章末钩子", [typeof item.endingHook === "string" ? item.endingHook : ""], 0.93);
        });
        const documents = prepared.memoryDocuments;
        documents.forEach((document, index) => {
          if (!document || typeof document !== "object") return;
          const item = document as Record<string, unknown>;
          const content = String(item.content || "").trim();
          if (!content) return;
          const kind = String(item.kind || item.title || "章节快照");
          store.saveMemory({
            id: `memory-document-${kind}-${index}`,
            projectId: normalizedProjectId,
            type: memoryTypeForDocument(kind),
            title: `记忆文档 · ${String(item.title || kind)}`,
            content: content.slice(0, 6000),
            entityNames: [],
            confirmed: true,
            importance: kind === "人物状态" || kind === "伏笔追踪" ? 0.99 : 0.9,
          });
        });
        streamEmitter.progress("starting", 8, `已载入 ${chapters.length} 个章节片段、${memoryItems.length} 条章节记忆；上下文包 ${Math.ceil(contextReport.packedBytes / 1024)} KB`);

        const graph = createChapterGraph({
          store,
          apiKey: String(apiKey),
          apiKeys: stringList(apiKeys, 12),
          baseURL: String(baseURL || "https://api.apisaver.com/v1"),
          model: String(model || "gpt-4o-mini"),
          apiMode: String(apiMode || "openai") as "openai" | "responses" | "anthropic",
          reasoningMode: String(reasoningMode || "auto"),
          contextWindowKB: Number(contextWindow) || undefined,
          ...networkProxyConfig(req.params),
          streamEmitter,
        });
        const result = await graph.invoke({
          projectId: normalizedProjectId,
          chapterId: String(chapterId),
          instruction: String(instruction),
          outline: prepared.outline,
          previousChapters: prepared.previousChapters,
          knowledgeGraph: prepared.knowledgeGraph,
          cards: prepared.cards,
          skillCatalog: prepared.skills,
          contextReport,
        });
        streamEmitter.complete("章节草稿和一致性审查已完成");
        return { id: req.id, result };
      } catch (error) {
        streamEmitter.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        store.close();
      }
    }
    return { id: req.id, error: { code: -32601, message: "Method not found" } };
  } catch (err) {
    return { id: req.id, error: { code: -32000, message: String(err) } };
  }
}

async function main() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line) as RPCRequest;
        const res = await handleRequest(req);
        process.stdout.write(JSON.stringify(res) + "\n");
      } catch (err) {
        process.stdout.write(JSON.stringify({ error: { code: -32700, message: "Parse error" } }) + "\n");
      }
    }
  }
}

main().catch(console.error);
