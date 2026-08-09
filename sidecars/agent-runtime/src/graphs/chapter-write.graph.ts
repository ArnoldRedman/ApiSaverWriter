import { StateGraph, Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import { StoryStore } from "../storage/story-store.js";
import { ApiSaverClient } from "../models/api-saver.js";
import type { StreamEmitter } from "../streaming/stream-handler.js";
import { StreamAccumulator } from "../streaming/stream-handler.js";
import { byteLength, compactText, formatContextReport, type ContextReport } from "../context/context-optimizer.js";

export interface SkillDefinition {
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  content: string;
}

const intentLabels: Record<string, string> = {
  setup: "项目设定与大纲",
  write: "章节创作与续写",
  review: "一致性审查与修改",
  polish: "文字润色与去模板化",
  import: "作品导入与结构化",
  analyze: "拆书分析与市场判断",
  tool: "写作辅助工具",
  creator: "技能设计",
};

// Keep these prompts byte-for-byte stable. Compatible providers can reuse this
// prefix on successive chapter runs instead of reprocessing the common rules.
const chapterWriterSystemPrompt = `你是专业长篇网络小说作者。只根据作者提供的作品资料创作，不编造与资料冲突的设定。

写作原则：
1. 服从章节任务、细纲、人物状态、时间线和已确认设定，资料冲突时以“已确认记忆”和作者任务为准。
2. 用具体动作、感官、对话和因果推进剧情；避免复述资料、解释写作过程、机械总结或套话。
3. 保持人物称谓、视角、时序、物品归属与关系一致；不把未知信息写成角色已知事实。
4. 正文使用自然的中文网文叙事，段落有节奏，结尾停在可继续发展的行动、发现或风险上。
5. 返回严格 JSON 对象，不要代码围栏或额外说明：{"content":"章节正文 Markdown","summary":"200 字以内章节摘要"}。`;

const chapterReviewSystemPrompt = `你是长篇小说一致性编辑。审查时只依据给出的约束与章节正文，不做文风重写，也不虚构问题。

重点检查：人物状态、已知信息、时间线、实体关系、物品归属和剧情因果。返回严格 JSON 对象，不要代码围栏或解释：{"consistent":true,"issues":["明确矛盾"],"suggestions":["可执行修订建议"]}。没有明确问题时 issues 和 suggestions 返回空数组。`;

export function selectSkillsByIntent(instruction: string, catalog: SkillDefinition[]): { intent: string; skills: SkillDefinition[] } {
  const query = instruction.toLowerCase();
  const scored = catalog.map(skill => {
    const terms = [skill.name, skill.category || "", skill.description || "", ...(skill.tags || [])]
      .join(" ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    let score = terms.reduce((total, term) => total + (term.length > 1 && query.includes(term) ? 2 : 0), 0);
    const categoryTerms: Record<string, string[]> = {
      setup: ["大纲", "设定", "世界观", "人物卡", "角色"],
      write: ["写", "续", "章节", "正文", "日更", "开书"],
      review: ["审查", "检查", "一致性", "逻辑", "矛盾"],
      polish: ["润色", "改写", "去ai", "自然", "文风"],
      import: ["导入", "解析", "已有小说"],
      analyze: ["分析", "拆书", "扫榜", "趋势", "题材"],
      tool: ["封面", "浏览器", "榜单"],
      creator: ["技能", "skill"],
    };
    score += (categoryTerms[skill.category || ""] || []).reduce((total, term) => total + (query.includes(term) ? 3 : 0), 0);
    return { skill, score };
  }).sort((left, right) => right.score - left.score);
  const selected = scored.filter(item => item.score > 0).slice(0, 3).map(item => item.skill);
  const fallback = catalog.find(skill => skill.name === "story-long-write") || catalog.find(skill => skill.category === "write");
  const skills = selected.length ? selected : (fallback ? [fallback] : []);
  const category = skills[0]?.category || "write";
  return { intent: intentLabels[category] || "章节创作与续写", skills };
}

export const ChapterState = Annotation.Root({
  projectId: Annotation<string>,
  chapterId: Annotation<string>,
  instruction: Annotation<string>,
  outline: Annotation<string | undefined>,
  previousChapters: Annotation<Array<{ id?: string | number; title: string; content: string }> | undefined>,
  knowledgeGraph: Annotation<string | undefined>,
  cards: Annotation<Array<{ type?: string; title: string; content: string }> | undefined>,
  skillCatalog: Annotation<SkillDefinition[]>({ reducer: (_prev, next) => next, default: () => [] }),
  selectedSkills: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  recognizedIntent: Annotation<string | undefined>,
  retrievedContext: Annotation<string[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  continuityContext: Annotation<string | undefined>,
  draftContent: Annotation<string | undefined>,
  summary: Annotation<string | undefined>,
  contextReport: Annotation<ContextReport | undefined>,
  reviewResult: Annotation<{
    consistent: boolean;
    issues: string[];
    suggestions: string[];
  } | undefined>,
  errors: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

export type ChapterStateType = typeof ChapterState.State;

interface ChapterGraphConfig {
  store: StoryStore;
  apiKey: string;
  apiKeys?: string[];
  baseURL?: string;
  model?: string;
  apiMode?: "openai" | "responses" | "anthropic";
  reasoningMode?: string;
  contextWindowKB?: number;
  proxyEnabled?: boolean;
  proxyURL?: string;
  proxyBypassLocal?: boolean;
  skillCatalog?: SkillDefinition[];
  streamEmitter?: StreamEmitter;
}

export function createChapterGraph(config: ChapterGraphConfig) {
  const store = config.store;
  const client = new ApiSaverClient({
    apiKey: config.apiKey,
    apiKeys: config.apiKeys,
    baseURL: config.baseURL,
    defaultModel: config.model,
    apiMode: config.apiMode,
    reasoningMode: config.reasoningMode,
    contextWindowKB: config.contextWindowKB,
    proxyEnabled: config.proxyEnabled,
    proxyURL: config.proxyURL,
    proxyBypassLocal: config.proxyBypassLocal,
  });
  const emitter = config.streamEmitter;

  const graph = new StateGraph(ChapterState)
    .addNode("intent", async (state: ChapterStateType) => {
      const selection = selectSkillsByIntent(state.instruction, state.skillCatalog);
      const continuitySkill = state.skillCatalog.find(skill => skill.name === "chapter-continuity");
      const useContinuity = continuitySkill && selection.intent === intentLabels.write;
      const selectedSkills = useContinuity
        ? [continuitySkill, ...selection.skills.filter(skill => skill.name !== continuitySkill.name)]
        : selection.skills;
      emitter?.progress("intent", 8, `识别意图：${selection.intent}，自动启用 ${selectedSkills.length} 个技能${useContinuity ? "（含章节承接）" : ""}`);
      return {
        recognizedIntent: selection.intent,
        selectedSkills: selectedSkills.slice(0, 3).map(skill => skill.name),
      };
    })
    .addNode("retrieve", async (state: ChapterStateType) => {
      emitter?.progress("retrieve", 10, "正在检索相关记忆...");
      
      // 从指令和细纲中提取关键词
      const query = [state.instruction, state.outline].filter(Boolean).join(" ");
      
      // 使用混合检索：FTS5 + 向量语义（如果已启用）
      let results;
      try {
        results = await store.searchHybrid(state.projectId, query, 5);
      } catch {
        // 如果向量检索未启用，降级到 FTS5
        results = store.searchExact(state.projectId, query, 5).map(r => ({
          ...r,
          similarity: 0.5,
        }));
      }

      // Structured memories are durable story constraints. Keep a small, high-priority
      // pack even when a new instruction has little lexical overlap with old chapters.
      const priorityTypes = new Set(["character_state", "foreshadowing", "timeline", "canon_fact"]);
      const priority = store.listConfirmed(state.projectId, 32)
        .filter(item => priorityTypes.has(item.type))
        .slice(0, 4)
        .map(item => ({ ...item, similarity: 1 }));
      const seen = new Set<string>();
      results = [...priority, ...results].filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, 7);
      
      let remaining = 4600;
      const context = results.flatMap(r => {
        if (remaining < 180) return [];
        const heading = `[${r.type} · ${compactText(r.title, 120)}]`;
        const content = compactText(r.content, Math.max(150, Math.min(760, remaining - byteLength(heading) - 8)));
        const item = `${heading}\n${content}`;
        remaining -= byteLength(item) + 2;
        return content ? [item] : [];
      });
      const retrievedBytes = byteLength(context.join("\n\n"));
      const contextReport = state.contextReport ? { ...state.contextReport, retrievedBytes } : undefined;
      
      emitter?.progress("retrieve", 25, `找到 ${context.length} 条相关记忆${contextReport ? `；${formatContextReport(contextReport)}` : ""}`);
      return { retrievedContext: context, contextReport };
    })
    .addNode("continuity", async (state: ChapterStateType) => {
      const previous = state.previousChapters?.[state.previousChapters.length - 1];
      if (!previous?.content?.trim()) {
        emitter?.progress("retrieve", 29, "没有上一章正文，按当前章节开篇创作");
        return { continuityContext: "（没有上一章正文；本章负责建立新的场景、人物位置和冲突。）" };
      }
      const relatedMemory = state.retrievedContext.find(item => item.includes(previous.title));
      const tail = compactText(previous.content, 2600);
      const continuityContext = `上一章：${previous.title}\n上一章结尾（最高优先级）：\n${tail}${relatedMemory ? `\n\n上一章结构记忆：\n${compactText(relatedMemory, 900)}` : ""}\n\n承接清单：开头先确认人物位置和情绪，处理未完成事件与章末钩子；场景或时间跳跃必须给出因果过渡。`;
      emitter?.progress("retrieve", 29, `已锁定${previous.title}结尾，生成阶段将优先承接`);
      return { continuityContext };
    })
    .addNode("draft", async (state: ChapterStateType) => {
      emitter?.progress("draft", 30, "正在组织章节设定、记忆和技能提示");
      
      // 构建 prompt
      const contextSection = state.retrievedContext.length > 0
        ? `\n## 相关背景\n${state.retrievedContext.join("\n\n")}\n`
        : "";
      
      const outlineSection = state.outline
        ? `\n## 章节细纲\n${state.outline}\n`
        : "";
      const graphSection = state.knowledgeGraph
        ? `\n## 知识图谱约束\n${state.knowledgeGraph}\n保持实体名称、类型和关系与图谱一致；新增关系需在正文中有依据。\n`
        : "";
      const cardsSection = state.cards?.length
        ? `\n## 本章知识卡片\n${state.cards.map(card => `### ${card.type || "知识卡"}：${card.title}\n${card.content}`).join("\n\n")}\n`
        : "";
      const skillsSection = state.selectedSkills.length
        ? `\n## 意图识别\n${state.recognizedIntent || "章节创作与续写"}\n\n## 自动选用技能\n${state.skillCatalog.filter(skill => state.selectedSkills.includes(skill.name)).slice(0, 3).map(skill => `### ${skill.name}\n${compactText(skill.content, skill.name === "chapter-continuity" ? 1800 : 700)}`).join("\n\n")}\n`
        : "";

      const continuitySection = state.continuityContext
        ? `\n## 章节承接（最高优先级）\n${state.continuityContext}\n`
        : "";
      const contextPacket = [continuitySection, outlineSection, cardsSection, graphSection, contextSection, skillsSection].filter(Boolean).join("");
      const taskPrompt = `## 本章任务\n${state.instruction}\n\n请创作 2000-3000 字左右的章节正文。`;
      const draftInputBytes = byteLength(chapterWriterSystemPrompt) + byteLength(contextPacket) + byteLength(taskPrompt);
      const contextReport = state.contextReport ? { ...state.contextReport, draftInputBytes } : undefined;

      // 流式生成文本
      const accumulator = new StreamAccumulator((chunk) => {
        emitter?.chunk(chunk);
      });

      emitter?.progress("draft", 38, "已提交模型请求，正在生成正文");
      const response = await client.chat([
        { role: "system", content: chapterWriterSystemPrompt },
        { role: "user", content: `## 作品资料\n${contextPacket || "（暂无额外资料）"}` },
        { role: "user", content: taskPrompt },
      ], { response_format: { type: "json_object" } });
      
      accumulator.append(response.content);
      emitter?.progress("draft", 70, "章节生成完成");

      try {
        const result = JSON.parse(response.content);
        return {
          draftContent: result.content || response.content,
          summary: result.summary,
          contextReport,
        };
      } catch {
        return { draftContent: response.content, contextReport };
      }
    })
    .addNode("review", async (state: ChapterStateType) => {
      emitter?.progress("review", 75, "正在审查章节...");
      
      if (!state.draftContent) {
        return {
          reviewResult: {
            consistent: false,
            issues: ["没有生成章节内容"],
            suggestions: [],
          },
        };
      }

      // 构建审查 prompt
      const contextSection = state.retrievedContext.length > 0
        ? `\n## 已知背景信息\n${state.retrievedContext.join("\n\n")}\n`
        : "";
      const cardsSection = state.cards?.length
        ? `\n## 本章引用卡片状态\n${state.cards.map(card => `${card.title}：${compactText(card.content, 260)}`).join("\n")}`
        : "";
      const graphSection = state.knowledgeGraph
        ? `\n## 知识图谱约束\n${state.knowledgeGraph}\n`
        : "";

      const reviewConstraints = `${cardsSection}${graphSection}${contextSection}`;
      const reviewDraft = compactText(state.draftContent, 10000);
      const reviewPrompt = `## 约束摘要\n${reviewConstraints || "（暂无额外约束）"}\n\n## 待审查章节\n${reviewDraft}`;
      const previousReport = state.contextReport;
      const reviewInputBytes = byteLength(chapterReviewSystemPrompt) + byteLength(reviewPrompt);
      const contextReport = previousReport ? {
        ...previousReport,
        reviewInputBytes,
        estimatedInputTokens: Math.ceil(((previousReport.draftInputBytes || 0) + reviewInputBytes) / 3),
      } : undefined;

      const response = await client.chat([
        { role: "system", content: chapterReviewSystemPrompt },
        { role: "user", content: reviewPrompt },
      ], { response_format: { type: "json_object" }, max_tokens: 650 });

      emitter?.progress("review", 95, "审查完成");

      try {
        const result = JSON.parse(response.content);
        return {
          reviewResult: {
            consistent: result.consistent ?? true,
            issues: result.issues || [],
            suggestions: result.suggestions || [],
          },
          contextReport,
        };
      } catch {
        return {
          reviewResult: {
            consistent: true,
            issues: [],
            suggestions: ["无法解析审查结果"],
          },
          contextReport,
        };
      }
    })
    .addEdge("__start__", "intent")
    .addEdge("intent", "retrieve")
    .addEdge("retrieve", "continuity")
    .addEdge("continuity", "draft")
    .addEdge("draft", "review")
    .addEdge("review", "__end__");

  return graph.compile();
}
