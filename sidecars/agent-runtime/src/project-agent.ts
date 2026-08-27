import { z } from "zod";
import { ApiSaverClient } from "./models/api-saver.js";
import { byteLength, compactText } from "./context/context-optimizer.js";

const cardTypes = ["角色卡", "物品卡", "地点卡", "势力卡", "金手指卡"] as const;
const outlineKinds = ["总纲", "章纲", "世界观与作品设定"] as const;
const memoryKinds = ["章节快照", "人物状态", "角色认知", "伏笔追踪", "时间线", "设定事实", "冲突"] as const;
const graphNodeTypes = ["chapter", "card", "outline", "entity"] as const;

// LLM 常用 0 / null / "" 表示"没有"，统一当作缺省；否则 positive 校验会直接判死整条变更
const optionalId = z.preprocess(
  value => value === 0 || value === "0" || value === "" || value === null ? undefined : value,
  z.coerce.number().int().positive().optional(),
);

const projectUpdate = z.object({
  type: z.literal("project.update"),
  summary: z.string().min(1).max(200),
  patch: z.object({
    title: z.string().min(1).max(120).optional(),
    synopsis: z.string().max(6000).optional(),
    genre: z.string().max(60).optional(),
    subgenre: z.string().max(60).optional(),
    protagonist1: z.string().max(80).optional(),
    protagonist2: z.string().max(80).optional(),
    status: z.enum(["writing", "completed"]).optional(),
    authorPreferences: z.array(z.string().min(1).max(300)).max(20).optional(),
  }).strict(),
});

const outlineUpsert = z.object({
  type: z.literal("outline.upsert"),
  summary: z.string().min(1).max(200),
  targetId: optionalId,
  kind: z.enum(outlineKinds),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(60_000),
  chapterId: optionalId,
});

const cardUpsert = z.object({
  type: z.literal("card.upsert"),
  summary: z.string().min(1).max(200),
  targetId: optionalId,
  cardType: z.enum(cardTypes),
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(40_000),
  currentState: z.string().max(6000).optional(),
});

const memoryDocumentUpsert = z.object({
  type: z.literal("memory.document.upsert"),
  summary: z.string().min(1).max(200),
  kind: z.enum(memoryKinds),
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(60_000),
});

const graphNodeUpsert = z.object({
  type: z.literal("graph.node.upsert"),
  summary: z.string().min(1).max(200),
  targetId: z.string().min(1).max(160),
  label: z.string().min(1).max(120),
  nodeType: z.enum(graphNodeTypes),
  category: z.string().max(80).optional(),
  content: z.string().max(30_000).optional(),
  nodeStatus: z.string().max(1000).optional(),
});

const graphEdgeUpsert = z.object({
  type: z.literal("graph.edge.upsert"),
  summary: z.string().min(1).max(200),
  targetId: z.string().min(1).max(240),
  source: z.string().min(1).max(160),
  target: z.string().min(1).max(160),
  label: z.string().min(1).max(80),
  weight: z.number().min(0.1).max(1).optional(),
});

// 委托意图：Agent 只描述目标和要求，正文交给应用里已有的大纲 / 卡片智能体生成，
// 避免它自己现编内容——那既绕过了专用提示词和技能，也会把单轮输出撑爆
const outlineWrite = z.object({
  type: z.literal("outline.write"),
  summary: z.string().min(1).max(200),
  targetId: optionalId,
  kind: z.enum(outlineKinds),
  title: z.string().min(1).max(160),
  instruction: z.string().min(1).max(4000),
});

const cardWrite = z.object({
  type: z.literal("card.write"),
  summary: z.string().min(1).max(200),
  targetId: optionalId,
  cardType: z.enum(cardTypes),
  title: z.string().min(1).max(120),
  instruction: z.string().min(1).max(4000),
});

const chapterDraftNext = z.object({
  type: z.literal("chapter.draft_next"),
  summary: z.string().min(1).max(200),
  title: z.string().min(1).max(160).optional(),
  instruction: z.string().min(1).max(6000),
  outlineId: optionalId,
});

const chapterCreate = z.object({
  type: z.literal("chapter.create"),
  summary: z.string().min(1).max(200),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(120_000),
  chapterPlan: z.string().max(30_000).optional(),
  chapterSummary: z.string().max(3000).optional(),
});

export const ProjectAgentChangeSchema = z.discriminatedUnion("type", [
  projectUpdate,
  outlineUpsert,
  cardUpsert,
  memoryDocumentUpsert,
  graphNodeUpsert,
  graphEdgeUpsert,
  chapterCreate,
]);

const plannerChangeSchema = z.discriminatedUnion("type", [
  projectUpdate,
  outlineWrite,
  cardWrite,
  memoryDocumentUpsert,
  graphNodeUpsert,
  graphEdgeUpsert,
  chapterDraftNext,
]);

const projectAgentPlanSchema = z.object({
  message: z.string().min(1).max(5000),
  changes: z.array(plannerChangeSchema).max(16).default([]),
});

export type ProjectAgentChange = z.infer<typeof ProjectAgentChangeSchema>;
export type ProjectAgentChapterRequest = z.infer<typeof chapterDraftNext>;
export type ProjectAgentOutlineRequest = z.infer<typeof outlineWrite>;
export type ProjectAgentCardRequest = z.infer<typeof cardWrite>;

// 三个委托口子都指向应用里已经存在的智能体
export interface ProjectAgentDelegates {
  chapter: (request: ProjectAgentChapterRequest) => Promise<z.infer<typeof chapterCreate>>;
  outline: (request: ProjectAgentOutlineRequest) => Promise<z.infer<typeof outlineUpsert>>;
  card: (request: ProjectAgentCardRequest) => Promise<z.infer<typeof cardUpsert>>;
}

export interface ProjectAgentToolEvent {
  tool: string;
  status: "complete" | "error";
  message: string;
}

export interface ProjectAgentResult {
  message: string;
  changes: ProjectAgentChange[];
  toolEvents: ProjectAgentToolEvent[];
}

interface ProjectAgentInput {
  mode: "discuss" | "execute";
  instruction: string;
  project: Record<string, unknown>;
  history?: Array<{ role?: unknown; content?: unknown }>;
  activeChapterId?: unknown;
  contextWindowKB?: unknown;
  maxSteps?: unknown;
  onStep?: (step: { kind: "search" | "open"; message: string }) => void;
}

interface ProjectDocument {
  kind: string;
  id: string;
  title: string;
  content: string;
  score: number;
}

const objectList = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
  : [];

const text = (value: unknown): string => typeof value === "string" ? value : "";

function queryTerms(value: string): string[] {
  const terms = value.toLocaleLowerCase().split(/[\s，。！？、；：,.!?;:()（）【】\[\]"“”'‘’]+/u)
    .map(item => item.trim()).filter(item => item.length >= 2);
  return Array.from(new Set(terms)).slice(0, 20);
}

// 原文只按本轮关键词截取短片段；续写时额外保留上一章结尾
function relevantExcerpt(content: string, terms: string[], tail = false): string {
  if (!content.trim()) return "";
  const lower = content.toLocaleLowerCase();
  const snippets: string[] = [];
  for (const term of terms) {
    let position = lower.indexOf(term);
    for (let count = 0; position >= 0 && count < 2; count += 1) {
      snippets.push(content.slice(Math.max(0, position - 180), Math.min(content.length, position + term.length + 360)).trim());
      position = lower.indexOf(term, position + term.length);
    }
    if (snippets.length >= 4) break;
  }
  if (snippets.length) return compactText(Array.from(new Set(snippets)).join("\n...\n"), 2200);
  if (tail) return compactText(content.slice(-5000), 2200);
  return compactText(content, 900);
}

function projectInventory(project: Record<string, unknown>, activeChapterId: unknown): string {
  const chapters = objectList(project.chapters);
  const outlines = objectList(project.outlines);
  const cards = objectList(project.cards);
  const memoryDocuments = objectList(project.memoryDocuments);
  const graphNodes = objectList(project.graphNodes);
  const graphEdges = objectList(project.graphEdges);
  return [
    `书名：${text(project.title) || "未命名小说"}`,
    `分类：${text(project.genre) || "未分类"}${project.subgenre ? ` / ${text(project.subgenre)}` : ""}`,
    `状态：${text(project.status) || "writing"}`,
    `主角：${[project.protagonist1, project.protagonist2].map(text).filter(Boolean).join("、") || "暂无"}`,
    `作品简介：${compactText(project.synopsis || "暂无", 1800)}`,
    `章节（${chapters.length}）：${chapters.map(item => `${String(item.id)}=${text(item.title)}${String(item.id) === String(activeChapterId) ? "[当前]" : ""}`).join("；")}`,
    `大纲（${outlines.length}）：${outlines.map(item => `${String(item.id)}=${text(item.kind)}｜${text(item.title)}`).join("；")}`,
    `卡片（${cards.length}）：${cards.map(item => `${String(item.id)}=${text(item.type)}｜${text(item.title)}`).join("；")}`,
    `记忆文档（${memoryDocuments.length}）：${memoryDocuments.map(item => `${String(item.id)}=${text(item.kind)}｜${text(item.title)}`).join("；")}`,
    `图谱节点（${graphNodes.length}）：${graphNodes.map(item => `${String(item.id)}=${text(item.type)}｜${text(item.label)}`).join("；")}`,
    `图谱关系（${graphEdges.length}）：${graphEdges.map(item => `${String(item.id)}:${String(item.source)}-[${text(item.label)}]->${String(item.target)}`).join("；")}`,
  ].join("\n");
}

export function buildProjectAgentContext(input: ProjectAgentInput): { packet: string; sources: string[] } {
  const { project, instruction } = input;
  const terms = queryTerms(instruction);
  const chapters = objectList(project.chapters);
  const outlines = objectList(project.outlines);
  const cards = objectList(project.cards);
  const memories = objectList(project.memories);
  const memoryDocuments = objectList(project.memoryDocuments);
  const graphNodes = objectList(project.graphNodes);
  const graphEdges = objectList(project.graphEdges);
  const needsContinuity = /下一章|续写|继续写|章节草稿|创作下一章/u.test(instruction);
  const domainBoost = {
    chapter: /章节|正文|下一章|续写|创作/u.test(instruction) ? 8 : 0,
    outline: /大纲|章纲|结构|剧情/u.test(instruction) ? 8 : 0,
    card: /卡片|人物|角色|物品|地点|势力/u.test(instruction) ? 8 : 0,
    memory: /记忆|伏笔|时间线|设定|冲突/u.test(instruction) ? 8 : 0,
    graph: /图谱|关系|实体/u.test(instruction) ? 8 : 0,
  };
  const score = (title: string, content: string, boost: number) => {
    const haystack = `${title}\n${content}`.toLocaleLowerCase();
    const lexical = terms.reduce((total, term) => total + (haystack.includes(term) ? 3 : 0), 0);
    return boost + lexical + (instruction.includes(title) && title.length >= 2 ? 12 : 0);
  };
  const documents: ProjectDocument[] = [
    ...chapters.map((item, index) => ({
      kind: "章节", id: String(item.id || index), title: text(item.title) || `第 ${index + 1} 章`,
      content: relevantExcerpt(text(item.content), terms, needsContinuity && index === chapters.length - 1),
      score: score(text(item.title), text(item.content), domainBoost.chapter) + (index >= chapters.length - 3 ? 5 : 0) + (String(item.id) === String(input.activeChapterId) ? 8 : 0),
    })),
    ...outlines.map((item, index) => ({
      kind: text(item.kind) || "大纲", id: String(item.id || index), title: text(item.title) || "未命名大纲", content: text(item.content),
      score: score(text(item.title), text(item.content), domainBoost.outline),
    })),
    ...cards.map((item, index) => ({
      kind: text(item.type) || "卡片", id: String(item.id || index), title: text(item.title) || "未命名卡片",
      content: `${text(item.content)}\n当前状态：${text(item.currentState) || "暂无"}`,
      score: score(text(item.title), `${text(item.content)} ${text(item.currentState)}`, domainBoost.card),
    })),
    ...memories.map((item, index) => ({
      kind: "章节记忆", id: String(item.id || index), title: text(item.chapterTitle) || "章节记忆", content: JSON.stringify(item),
      score: score(text(item.chapterTitle), JSON.stringify(item), domainBoost.memory),
    })),
    ...memoryDocuments.map((item, index) => ({
      kind: text(item.kind) || "记忆文档", id: String(item.id || index), title: text(item.title) || "记忆文档", content: text(item.content),
      score: score(text(item.title), text(item.content), domainBoost.memory),
    })),
    ...graphNodes.map((item, index) => ({
      kind: "图谱节点", id: String(item.id || index), title: text(item.label) || "图谱节点",
      content: `${text(item.category || item.type)}\n${text(item.status)}\n${text(item.content)}`,
      score: score(text(item.label), `${text(item.category)} ${text(item.status)} ${text(item.content)}`, domainBoost.graph),
    })),
  ].sort((left, right) => right.score - left.score);

  const budget = Math.min(36_000, Math.max(12_000, (Number(input.contextWindowKB) || 128) * 1024 * 0.28));
  const inventory = projectInventory(project, input.activeChapterId);
  const sections: string[] = [`## 项目索引\n${compactText(inventory, Math.min(14_000, Math.floor(budget * 0.28)))}`];
  const sources: string[] = [];
  let used = byteLength(sections[0]);
  for (const document of documents) {
    if (document.score <= 0 && sources.length >= 8) continue;
    const remaining = budget - used;
    if (remaining < 500 || sources.length >= 16) break;
    const documentLimit = document.kind === "章节" ? 2200 : document.kind.includes("大纲") ? 4200 : document.kind.includes("卡") ? 2400 : 3600;
    const content = compactText(document.content, Math.min(documentLimit, remaining - 160));
    if (!content) continue;
    const section = `## ${document.kind}｜${document.id}｜${document.title}\n${content}`;
    sections.push(section);
    sources.push(`${document.kind}｜${document.title}`);
    used += byteLength(section);
  }
  if (domainBoost.graph) {
    const graph = compactText(JSON.stringify({ nodes: graphNodes, edges: graphEdges }), Math.max(1000, Math.min(6000, budget - used)));
    if (graph) {
      sections.push(`## 知识图谱结构\n${graph}`);
      sources.push("知识图谱结构");
    }
  }
  return { packet: sections.join("\n\n"), sources };
}

function parsePlannerResponse(value: string): z.infer<typeof projectAgentPlanSchema> {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  return projectAgentPlanSchema.parse(JSON.parse(cleaned));
}

// Agent 每一轮只返回一个动作：继续检索、打开某份资料，或收尾给出回复与变更提案
const agentTurnSchema = z.union([
  z.object({ action: z.literal("search"), query: z.string().min(1).max(200) }),
  z.object({ action: z.literal("open"), kind: z.string().max(40).optional(), id: z.union([z.string(), z.number()]) }),
  z.object({ action: z.literal("finish"), message: z.string().min(1).max(5000), changes: z.array(z.unknown()).max(16).default([]) }),
]);

type ProjectAgentTurn = z.infer<typeof agentTurnSchema>;

const changeTypeNames = new Set<string>([
  "project.update", "outline.upsert", "card.upsert", "memory.document.upsert",
  "graph.node.upsert", "graph.edge.upsert", "chapter.draft_next",
]);

function parseAgentTurn(value: string): ProjectAgentTurn {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const action = typeof parsed.action === "string" ? parsed.action : "";
  // 模型经常把变更的 type 直接填进 action，或者干脆只回一个变更对象；都归一成"带一条变更的收尾"
  if (changeTypeNames.has(action) || (!action && changeTypeNames.has(String(parsed.type || "")))) {
    const { action: _discarded, ...rest } = parsed;
    const change = { ...rest, type: changeTypeNames.has(action) ? action : parsed.type };
    return agentTurnSchema.parse({
      action: "finish",
      message: typeof parsed.summary === "string" && parsed.summary ? parsed.summary : "已生成待确认变更。",
      changes: [change],
    });
  }
  // 兼容只回 {message, changes} 的旧格式
  if (!action && typeof parsed.message === "string") {
    return agentTurnSchema.parse({ action: "finish", message: parsed.message, changes: parsed.changes ?? [] });
  }
  return agentTurnSchema.parse(parsed);
}

// 全量文档表：search 只回标题和片段，正文要等 open 才完整取出，避免一次把整本书塞进提示词
function projectDocuments(project: Record<string, unknown>): ProjectDocument[] {
  const entry = (kind: string, id: unknown, title: string, content: string): ProjectDocument =>
    ({ kind, id: String(id ?? ""), title: title || "未命名", content, score: 0 });
  return [
    ...objectList(project.chapters).map((item, index) => entry("章节", item.id ?? index, text(item.title) || `第 ${index + 1} 章`, text(item.content))),
    ...objectList(project.outlines).map((item, index) => entry(text(item.kind) || "大纲", item.id ?? index, text(item.title), text(item.content))),
    ...objectList(project.cards).map((item, index) => entry(text(item.type) || "卡片", item.id ?? index, text(item.title), `${text(item.content)}\n当前状态：${text(item.currentState) || "暂无"}`)),
    ...objectList(project.memories).map((item, index) => entry("章节记忆", item.id ?? index, text(item.chapterTitle) || "章节记忆", JSON.stringify(item))),
    ...objectList(project.memoryDocuments).map((item, index) => entry(text(item.kind) || "记忆文档", item.id ?? index, text(item.title), text(item.content))),
    ...objectList(project.graphNodes).map((item, index) => entry("图谱节点", item.id ?? index, text(item.label), `${text(item.category || item.type)}\n${text(item.status)}\n${text(item.content)}`)),
  ];
}

function runSearch(documents: ProjectDocument[], query: string): string {
  const terms = queryTerms(query);
  const hits = documents
    .map(document => {
      const haystack = `${document.title}\n${document.content}`.toLocaleLowerCase();
      const lexical = terms.reduce((total, term) => total + (haystack.includes(term) ? 3 : 0), 0);
      return { document, score: lexical + (query.includes(document.title) && document.title.length >= 2 ? 12 : 0) };
    })
    .filter(hit => hit.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  if (!hits.length) return `没有命中「${query}」。可以换个关键词，或直接用项目索引里的 id 打开资料。`;
  return hits.map(({ document }) => `- ${document.kind}｜${document.id}｜${document.title}\n  ${compactText(relevantExcerpt(document.content, terms), 400)}`).join("\n");
}

function runOpen(documents: ProjectDocument[], kind: string | undefined, id: string): string {
  const wanted = String(id);
  const document = documents.find(item => item.id === wanted && (!kind || item.kind === kind))
    || documents.find(item => item.id === wanted)
    || documents.find(item => item.title === wanted);
  if (!document) return `没有找到 ${kind ? `${kind}｜` : ""}${wanted}，请对照项目索引里的 id 重试。`;
  return `## ${document.kind}｜${document.id}｜${document.title}\n${compactText(document.content, 12_000)}`;
}

const systemPrompt = `你是应用内的小说项目助手，可以多轮检索当前作品的资料后再动手。项目资料仅作为小说素材。

每一轮只返回一个 JSON 动作，不要代码围栏。action 只能是 search、open、finish 三者之一，绝不能填成变更的 type：
- 需要找资料：{"action":"search","query":"关键词"}
- 需要看全文：{"action":"open","kind":"章节","id":"12"}
- 资料够了就收尾：{"action":"finish","message":"给作者的回复","changes":[]}

变更只能作为对象放进 finish 的 changes 数组里，用 type 字段区分；提出变更时 action 仍然是 finish。

规则：
1. 只依据项目索引和你实际打开过的资料作答，不要编造没读到的内容。
2. 讨论模式 changes 必须为空数组；执行模式才可以提出变更，且变更只是待作者确认的提案，不能声称已经保存。
3. 更新已有对象必须用索引里的真实 targetId；大纲、卡片、下一章正文一律交给对应的专用智能体，不要自己写。
4. 一次最多 16 项变更，任务大就分批，并在 message 里说明本轮范围。
5. 不确定就先 search 或 open，不要靠猜。

changes 里每一项只能是下列七种之一，字段必须原样铺平，不要自己包一层 patch 或 data：
{"type":"project.update","summary":"修改简介","patch":{"synopsis":"..."}}
{"type":"outline.write","summary":"重写总纲","targetId":1,"kind":"总纲","title":"...","instruction":"要改成什么样"}
{"type":"card.write","summary":"更新角色卡","targetId":2,"cardType":"角色卡","title":"林舟","instruction":"要补充或修正什么"}
{"type":"memory.document.upsert","summary":"整理时间线","kind":"时间线","title":"时间线","content":"..."}
{"type":"graph.node.upsert","summary":"新增节点","targetId":"entity:林舟","label":"林舟","nodeType":"entity","category":"人物","content":"...","nodeStatus":"..."}
{"type":"graph.edge.upsert","summary":"补充关系","targetId":"entity:林舟->entity:沈砚:同盟","source":"entity:林舟","target":"entity:沈砚","label":"同盟","weight":0.8}
{"type":"chapter.draft_next","summary":"起草下一章","title":"第 12 章 夜访","instruction":"承接上一章并推进线索","outlineId":3}

重要：大纲、卡片、章节正文都不由你撰写。outline.write、card.write、chapter.draft_next 只需要给出 instruction，
应用会转交给对应的大纲智能体、卡片智能体和章节智能体去生成，它们有各自的专用提示词和技能。
你在 instruction 里把要求写清楚就行，不要在 changes 里塞正文。
只有 project.update 用 patch；memory.document.upsert 和图谱两项因为没有专用智能体，才由你直接给出内容。`;

export async function runProjectAgent(
  input: ProjectAgentInput,
  client: ApiSaverClient,
  delegates: ProjectAgentDelegates,
): Promise<ProjectAgentResult> {
  const context = buildProjectAgentContext(input);
  const documents = projectDocuments(input.project);
  const history = (input.history || []).slice(-10).flatMap(message => {
    const role: "user" | "assistant" | null = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
    const content = compactText(message.content || "", 4000);
    return role && content ? [{ role, content }] : [];
  });
  const toolEvents: ProjectAgentToolEvent[] = [{
    tool: "project.context",
    status: "complete",
    message: `已载入项目索引与 ${context.sources.length} 份相关资料`,
  }];

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: `模式：${input.mode === "execute" ? "执行（可提出待确认变更）" : "讨论（禁止提出变更）"}\n\n## 当前项目资料\n${context.packet}\n\n## 本轮请求\n${input.instruction}` },
  ];

  // ponytail: 步数和累计工具输出都是硬上限，够用就停；需要更深的检索再把上限做成设置项
  const maxSteps = Math.max(1, Math.min(12, Number(input.maxSteps) || 6));
  const toolOutputBudget = 48_000;
  let toolOutputUsed = 0;
  let plan: Extract<ProjectAgentTurn, { action: "finish" }> | null = null;

  for (let step = 0; step < maxSteps && !plan; step += 1) {
    const mustFinish = step === maxSteps - 1 || toolOutputUsed >= toolOutputBudget;
    const turnMessages = mustFinish
      ? [...messages, { role: "user" as const, content: "检索预算已用尽，请直接返回 finish 动作。" }]
      : messages;
    const response = await client.chat(turnMessages, { response_format: { type: "json_object" }, temperature: 0.2, max_tokens: 12_000, retryAttempts: 2 });

    let turn: ProjectAgentTurn;
    try {
      turn = parseAgentTurn(response.content);
    } catch {
      // 只修格式不补事实；修不好就把原文当成纯文本回复收尾，不让一次格式抖动毁掉整轮
      const repaired = await client.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: `请把以下内容整理成约定的 JSON 动作，只调整格式：\n${compactText(response.content, 6000)}` },
      ], { response_format: { type: "json_object" }, temperature: 0, max_tokens: 12_000, retryAttempts: 1 });
      try {
        turn = parseAgentTurn(repaired.content);
      } catch {
        // 两轮都没修好就如实说明，不要把原始 JSON 当成回复扔给作者
        turn = { action: "finish", message: "模型这轮没有按约定格式回复，请再说一次或换个说法。", changes: [] };
      }
    }

    if (turn.action === "finish") {
      plan = turn;
      break;
    }

    const label = turn.action === "search" ? `检索「${turn.query}」` : `打开 ${turn.kind ? `${turn.kind}｜` : ""}${turn.id}`;
    const result = turn.action === "search" ? runSearch(documents, turn.query) : runOpen(documents, turn.kind, String(turn.id));
    toolOutputUsed += byteLength(result);
    toolEvents.push({ tool: `project.${turn.action}`, status: "complete", message: label });
    input.onStep?.({ kind: turn.action, message: label });
    messages.push({ role: "assistant", content: JSON.stringify(turn) });
    messages.push({ role: "user", content: `工具结果（${label}）：\n${result}` });
  }

  if (!plan) return { message: "本轮检索没有收敛出结论，请换个说法再试一次。", changes: [], toolEvents };
  if (input.mode === "discuss") return { message: plan.message, changes: [], toolEvents };

  const changes: ProjectAgentChange[] = [];
  for (const raw of plan.changes) {
    // 逐条校验：一条写坏只丢这一条并如实报出来，不连累其余变更和回复正文
    const parsed = plannerChangeSchema.safeParse(raw);
    if (!parsed.success) {
      const type = raw && typeof raw === "object" ? String((raw as Record<string, unknown>).type || "未知") : "未知";
      toolEvents.push({ tool: "change.reject", status: "error", message: `变更 ${type} 字段不合法，已丢弃：${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "根"} ${issue.message}`).join("；")}` });
      continue;
    }
    const change = parsed.data;
    // 三种写入意图都转交给应用里已有的专用智能体，产出结果再变成待确认提案
    const delegateFor = {
      "chapter.draft_next": { label: "章节智能体", run: () => delegates.chapter(change as ProjectAgentChapterRequest) },
      "outline.write": { label: "大纲智能体", run: () => delegates.outline(change as ProjectAgentOutlineRequest) },
      "card.write": { label: "卡片智能体", run: () => delegates.card(change as ProjectAgentCardRequest) },
    }[change.type as string];
    if (!delegateFor) {
      changes.push(ProjectAgentChangeSchema.parse(change));
      continue;
    }
    try {
      const produced = await delegateFor.run();
      changes.push(ProjectAgentChangeSchema.parse(produced));
      toolEvents.push({ tool: change.type, status: "complete", message: `${delegateFor.label}已完成《${produced.title}》` });
    } catch (error) {
      toolEvents.push({ tool: change.type, status: "error", message: `${delegateFor.label}失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { message: plan.message, changes, toolEvents };
}
