import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';
import { countNovelCharacters } from './utils/text';
import { builtinSkills } from './data/builtin-skills';

export interface Skill {
  id: number | string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  rating: number;
  usageCount: number;
  content: string;
  builtin?: boolean;
}

interface Chapter {
  id: number;
  title: string;
  content: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

interface OutlineNode {
  id: number;
  title: string;
  description: string;
  type: 'arc' | 'chapter' | 'scene';
  children?: OutlineNode[];
  status: 'planned' | 'writing' | 'completed';
}

type OutlineKind = '总纲' | '细纲' | '金手指' | '世界观与作品设定';

interface OutlineDocument {
  id: number;
  kind: OutlineKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

type CardType = '角色卡' | '物品卡' | '地点卡' | '势力卡' | '金手指卡';

interface KnowledgeCard {
  id: number;
  type: CardType;
  title: string;
  content: string;
  currentState?: string;
  stateHistory?: Array<{ chapterId: number; chapterTitle: string; status: string; changes: string; updatedAt: string }>;
  createdAt: string;
  updatedAt: string;
}

interface ChapterMemory {
  id: number;
  chapterId: number;
  chapterTitle: string;
  summary: string;
  keywords: string[];
  characterStateChanges: string[];
  knowledgeChanges: string[];
  foreshadowingChanges: string[];
  timelineEvents: string[];
  canonFacts: string[];
  conflicts: string[];
  endingHook: string;
  sourceChapterNumber?: number;
  createdAt: string;
  updatedAt: string;
}

type PublishPlatform = 'fanqie';

interface PublishConfig {
  platform: PublishPlatform;
  enabled: boolean;
  creatorURL: string;
  bookId: string;
  autoPublishOnSave: boolean;
}

interface PublishRecord {
  id: string;
  chapterId: number;
  chapterTitle: string;
  platform: PublishPlatform;
  status: 'published' | 'prepared' | 'login_required' | 'manual_required' | 'error';
  message: string;
  url?: string;
  updatedAt: string;
}

interface AIDetectionChapter {
  chapterId: number;
  chapterTitle: string;
  wordCount: number;
  sentenceUniformity: number;
  logicFrequency: number;
  colloquialFrequency: number;
  psychologicalFrequency: number;
  paragraphUniformity: number;
  aiRate: number;
  humanRate: number;
}

interface AIDetectionReport {
  updatedAt: string;
  scope: 'chapter' | 'book';
  chapters: AIDetectionChapter[];
  averageAIRate: number;
  level: string;
  suggestion: string;
}

type MemoryDocumentKind = '章节快照' | '人物状态' | '角色认知' | '伏笔追踪' | '时间线' | '设定事实' | '冲突';

interface MemoryDocument {
  id: string;
  kind: MemoryDocumentKind;
  title: string;
  content: string;
  updatedAt: string;
  manuallyEdited?: boolean;
}

interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: 'chapter' | 'card' | 'outline' | 'entity';
  category?: string;
}

interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface Project {
  id: number;
  title: string;
  genre: string;
  subgenre?: string;
  tags?: Partial<Record<TagTab, string[]>>;
  cover?: string;
  protagonist1?: string;
  protagonist2?: string;
  synopsis?: string;
  status: 'writing' | 'completed';
  chapters: Chapter[];
  outline: OutlineNode[];
  outlines: OutlineDocument[];
  cards: KnowledgeCard[];
  memories: ChapterMemory[];
  memoryDocuments: MemoryDocument[];
  graphNodes: KnowledgeGraphNode[];
  graphEdges: KnowledgeGraphEdge[];
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  publishConfig?: PublishConfig;
  publishRecords?: PublishRecord[];
  aiDetection?: AIDetectionReport;
  chapterTargetWords?: number;
}

interface AIToolResult {
  mode: 'polish' | 'continue';
  content: string;
  source?: string;
  start?: number;
  end?: number;
  maxWords?: number;
}

interface AgentReviewResult {
  consistent: boolean;
  issues: string[];
  suggestions: string[];
}

interface AgentDraftResult {
  draftContent?: string;
  summary?: string;
  reviewResult?: AgentReviewResult;
  retrievedContext?: string[];
  recognizedIntent?: string;
  selectedSkills?: string[];
  contextReport?: {
    cache?: 'hit' | 'miss';
    sourceBytes?: number;
    packedBytes?: number;
    prunedBytes?: number;
    budgetBytes?: number;
    retrievedBytes?: number;
    draftInputBytes?: number;
    reviewInputBytes?: number;
    estimatedInputTokens?: number;
    sections?: Record<string, number>;
  };
}

interface AgentMemoryResult {
  summary?: string;
  keywords?: string[];
  characterStateChanges?: string[];
  knowledgeChanges?: string[];
  foreshadowingChanges?: string[];
  timelineEvents?: string[];
  canonFacts?: string[];
  conflicts?: string[];
  endingHook?: string;
  entities?: Array<{ name?: string; type?: string }>;
  relations?: Array<{ source?: string; target?: string; label?: string }>;
  cardUpdates?: Array<{ cardId?: number | string; cardTitle?: string; status?: string; changes?: string }>;
  contextReport?: AgentDraftResult['contextReport'];
}

type AgentStage = 'idle' | 'starting' | 'intent' | 'retrieve' | 'draft' | 'review' | 'done' | 'error';
type ApiMode = 'openai' | 'responses' | 'anthropic';
type ReasoningMode = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max' | 'custom';
type AgentProgressStatus = 'pending' | 'active' | 'complete' | 'error';

interface AgentConfig {
  serviceName: string;
  enabled: boolean;
  apiMode: ApiMode;
  baseURL: string;
  apiKey: string;
  apiKeys: string[];
  model: string;
  contextWindow: number;
  reasoningMode: ReasoningMode;
  proxyEnabled: boolean;
  proxyURL: string;
  proxyBypassLocal: boolean;
}

const agentStageLabel: Record<AgentStage, string> = {
  idle: '待命',
  starting: '启动智能体',
  intent: '识别创作意图',
  retrieve: '检索上下文',
  draft: '生成正文',
  review: '审查一致性',
  done: '草稿完成',
  error: '运行失败',
};

const agentWorkflowSteps = [
  { id: 'starting', label: '准备运行环境', description: '整理章节、卡片和已选记忆' },
  { id: 'intent', label: '识别创作意图', description: '选择适用的写作技能' },
  { id: 'retrieve', label: '检索故事记忆', description: '读取相关人物、设定和时间线' },
  { id: 'draft', label: '生成章节草稿', description: '组织上下文并调用模型写作' },
  { id: 'review', label: '审查一致性', description: '检查人物、逻辑与时间线' },
] as const;

type AgentWorkflowStepId = typeof agentWorkflowSteps[number]['id'];

interface AgentProgressItem {
  id: AgentWorkflowStepId;
  label: string;
  description: string;
  status: AgentProgressStatus;
  message: string;
  progress: number;
}

interface AgentProgressEvent {
  runId?: string;
  type?: 'progress' | 'chunk' | 'complete' | 'error';
  data?: {
    step?: string;
    progress?: number;
    text?: string;
    message?: string;
    error?: string;
  };
}

const createAgentProgressItems = (): AgentProgressItem[] => agentWorkflowSteps.map(step => ({
  ...step,
  status: 'pending',
  message: '',
  progress: 0,
}));

const isAgentWorkflowStep = (value: string | undefined): value is AgentWorkflowStepId => Boolean(value && agentWorkflowSteps.some(step => step.id === value));
const agentRunning = (stage: AgentStage) => !['idle', 'done', 'error'].includes(stage);

const defaultBaseURL = 'https://api.apisaver.com/v1';
const agentNetworkParams = (config: AgentConfig) => ({
  proxyEnabled: config.proxyEnabled,
  proxyURL: config.proxyURL.trim(),
  proxyBypassLocal: config.proxyBypassLocal,
});
const defaultPublishConfig: PublishConfig = {
  platform: 'fanqie',
  enabled: false,
  creatorURL: 'https://fanqienovel.com/main/writer',
  bookId: '',
  autoPublishOnSave: false,
};
const fallbackModels = ['gpt-5.6-luna', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.4'];
const outlineKinds: OutlineKind[] = ['总纲', '细纲', '金手指', '世界观与作品设定'];
const memoryDocumentKinds: MemoryDocumentKind[] = ['章节快照', '人物状态', '角色认知', '伏笔追踪', '时间线', '设定事实', '冲突'];

const memoryDocumentId = (kind: MemoryDocumentKind) => `memory-document:${kind}`;
const asTextList = (value: unknown, limit = 20) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, limit)
  : [];
const memoryTextList = (value: string) => value.split(/\r?\n|、/).map(item => item.trim()).filter(Boolean).slice(0, 30);

const chapterOrder = (memory: ChapterMemory) => memory.sourceChapterNumber ?? memory.chapterId;
const recentMemoryIds = (memories: ChapterMemory[], limit = 1) => [...memories]
  .sort((left, right) => chapterOrder(left) - chapterOrder(right))
  .slice(-limit)
  .map(memory => memory.id);

const memoryListMarkdown = (items: string[]) => items.length ? items.map(item => `- ${item}`).join('\n') : '- 暂无';

const snapshotMarkdown = (memory: ChapterMemory) => `# ${memory.chapterTitle} 记忆快照

## 章节摘要
${memory.summary || '暂无摘要'}

## 关键词
${memory.keywords.length ? memory.keywords.map(item => `- ${item}`).join('\n') : '- 暂无'}

## 人物状态变化
${memoryListMarkdown(memory.characterStateChanges)}

## 角色认知变化
${memoryListMarkdown(memory.knowledgeChanges)}

## 伏笔变化
${memoryListMarkdown(memory.foreshadowingChanges)}

## 时间线事件
${memoryListMarkdown(memory.timelineEvents)}

## 设定事实
${memoryListMarkdown(memory.canonFacts)}

## 冲突
${memoryListMarkdown(memory.conflicts)}

## 章末钩子
${memory.endingHook || '暂无'}
`;

const buildMemoryDocuments = (memories: ChapterMemory[], existingDocuments: MemoryDocument[] = [], force = false): MemoryDocument[] => {
  const ordered = [...memories].sort((left, right) => chapterOrder(left) - chapterOrder(right));
  const sections = (title: string, entries: Array<{ memory: ChapterMemory; items: string[] }>) => `# ${title}\n\n${entries.length
    ? entries.map(({ memory, items }) => `## ${memory.chapterTitle}\n${memoryListMarkdown(items)}`).join('\n\n')
    : '暂无已保存章节记忆。'}\n`;
  const documentContent: Record<MemoryDocumentKind, string> = {
    '章节快照': `# 章节快照\n\n${ordered.length ? ordered.map(memory => `## ${memory.chapterTitle}\n${memory.summary || '暂无摘要'}\n\n关键词：${memory.keywords.join('、') || '暂无'}\n\n人物状态：${memory.characterStateChanges.join('；') || '暂无'}\n认知变化：${memory.knowledgeChanges.join('；') || '暂无'}\n伏笔：${memory.foreshadowingChanges.join('；') || '暂无'}\n时间线：${memory.timelineEvents.join('；') || '暂无'}\n设定事实：${memory.canonFacts.join('；') || '暂无'}\n冲突：${memory.conflicts.join('；') || '暂无'}\n章末钩子：${memory.endingHook || '暂无'}`).join('\n\n---\n\n') : '暂无已保存章节记忆。'}\n`,
    '人物状态': sections('人物状态', ordered.map(memory => ({ memory, items: memory.characterStateChanges }))),
    '角色认知': sections('角色认知', ordered.map(memory => ({ memory, items: memory.knowledgeChanges }))),
    '伏笔追踪': sections('伏笔追踪', ordered.map(memory => ({ memory, items: memory.foreshadowingChanges }))),
    '时间线': sections('时间线', ordered.map(memory => ({ memory, items: memory.timelineEvents }))),
    '设定事实': sections('设定事实', ordered.map(memory => ({ memory, items: memory.canonFacts }))),
    '冲突': sections('冲突', ordered.map(memory => ({ memory, items: memory.conflicts }))),
  };
  const now = new Date().toISOString();
  return memoryDocumentKinds.map(kind => {
    const existing = existingDocuments.find(document => document.kind === kind);
    const preserveManual = Boolean(existing?.manuallyEdited) && !force;
    return {
      id: memoryDocumentId(kind),
      kind,
      title: kind,
      content: preserveManual ? existing?.content ?? documentContent[kind] : documentContent[kind],
      updatedAt: preserveManual ? existing?.updatedAt ?? now : now,
      manuallyEdited: preserveManual,
    };
  });
};

const hydrateMemoryDocuments = (documents: unknown, memories: ChapterMemory[]): MemoryDocument[] => {
  const generated = buildMemoryDocuments(memories);
  if (!Array.isArray(documents) || documents.length === 0) return generated;
  return generated.map(template => {
    const saved = documents.find(item => item && typeof item === 'object' && (item as MemoryDocument).kind === template.kind) as Partial<MemoryDocument> | undefined;
    if (!saved) return template;
    const content = typeof saved.content === 'string' ? saved.content : template.content;
    return {
      ...template,
      ...saved,
      id: memoryDocumentId(template.kind),
      kind: template.kind,
      title: template.kind,
      content,
      manuallyEdited: Boolean(saved.manuallyEdited) || content !== template.content,
    };
  });
};

const normalizeChapterMemory = (memory: Partial<ChapterMemory>, fallbackChapter?: Chapter): ChapterMemory => {
  const now = new Date().toISOString();
  return {
    id: typeof memory.id === 'number' ? memory.id : Date.now(),
    chapterId: typeof memory.chapterId === 'number' ? memory.chapterId : (fallbackChapter?.id ?? 0),
    chapterTitle: typeof memory.chapterTitle === 'string' ? memory.chapterTitle : (fallbackChapter?.title ?? '未命名章节'),
    summary: typeof memory.summary === 'string' ? memory.summary : '',
    keywords: asTextList(memory.keywords, 8),
    characterStateChanges: asTextList(memory.characterStateChanges),
    knowledgeChanges: asTextList(memory.knowledgeChanges),
    foreshadowingChanges: asTextList(memory.foreshadowingChanges),
    timelineEvents: asTextList(memory.timelineEvents),
    canonFacts: asTextList(memory.canonFacts),
    conflicts: asTextList(memory.conflicts),
    endingHook: typeof memory.endingHook === 'string' ? memory.endingHook : '',
    sourceChapterNumber: typeof memory.sourceChapterNumber === 'number' ? memory.sourceChapterNumber : undefined,
    createdAt: typeof memory.createdAt === 'string' ? memory.createdAt : now,
    updatedAt: typeof memory.updatedAt === 'string' ? memory.updatedAt : (typeof memory.createdAt === 'string' ? memory.createdAt : now),
  };
};

const buildLocalChapterSummary = (content: string) => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 220) return normalized;
  const sentences = normalized.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [];
  const summary = sentences.slice(0, 3).join('').trim();
  return summary.length > 220 ? `${summary.slice(0, 220)}...` : summary;
};

const extractLocalKeywords = (content: string) => {
  const ignored = new Set(['这一章', '故事', '小说', '主角', '他们', '自己', '已经', '没有', '一个', '什么']);
  const matches = content.match(/[\u4e00-\u9fff]{2,6}/g) ?? [];
  return Array.from(new Set(matches.filter(word => !ignored.has(word)))).slice(0, 8);
};

const analyzeAIChapter = (chapter: Chapter): AIDetectionChapter => {
  const text = chapter.content.replace(/^【第\d+章[^】]*】\s*/u, '').replace(/（本章完）\s*$/u, '').trim();
  const sentences = text.split(/[。！？\n]/u).map(item => item.trim()).filter(Boolean);
  const lengths = sentences.map(item => item.length);
  const average = lengths.length ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : 0;
  const variance = lengths.length ? lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) / lengths.length : 0;
  const sentenceUniformity = lengths.length ? Math.max(0, 100 - Math.sqrt(variance) * 2) : 50;
  const logicWords = ['但是', '不过', '然而', '因此', '所以', '首先', '其次', '最后', '总之', '综上所述'];
  const colloquialWords = ['咋', '啥', '呗', '嘛', '呢', '啊', '呀', '咯', '喽', '琢磨', '寻思', '要得'];
  const psychologicalPatterns = ['心里一', '心里头', '心里有', '心里明白', '心里盘算'];
  const perHundred = (count: number) => text.length ? count / (text.length / 100) : 0;
  const logicFrequency = perHundred(logicWords.reduce((sum, word) => sum + text.split(word).length - 1, 0));
  const colloquialFrequency = perHundred(colloquialWords.reduce((sum, word) => sum + text.split(word).length - 1, 0));
  const psychologicalFrequency = perHundred(psychologicalPatterns.reduce((sum, word) => sum + text.split(word).length - 1, 0));
  const paragraphs = text.split(/\n\n/u).map(item => item.trim()).filter(Boolean);
  const paragraphLengths = paragraphs.map(item => item.length);
  const paragraphAverage = paragraphLengths.length ? paragraphLengths.reduce((sum, length) => sum + length, 0) / paragraphLengths.length : 0;
  const paragraphVariance = paragraphLengths.length ? paragraphLengths.reduce((sum, length) => sum + (length - paragraphAverage) ** 2, 0) / paragraphLengths.length : 0;
  const paragraphUniformity = paragraphs.length > 1 ? Math.max(0, 100 - Math.sqrt(paragraphVariance)) : 50;
  const logicScore = Math.min(1, logicFrequency * 10 / 100);
  const colloquialScore = Math.min(1, colloquialFrequency * 20 / 100);
  const aiRate = Math.min(100, Math.max(0, sentenceUniformity / 100 * 25 + logicScore * 25 + (1 - colloquialScore) * 25 + Math.min(1, psychologicalFrequency * 5) * 15 + paragraphUniformity / 100 * 10));
  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    wordCount: countNovelCharacters(chapter.content),
    sentenceUniformity: Number(sentenceUniformity.toFixed(1)),
    logicFrequency: Number(logicFrequency.toFixed(2)),
    colloquialFrequency: Number(colloquialFrequency.toFixed(2)),
    psychologicalFrequency: Number(psychologicalFrequency.toFixed(2)),
    paragraphUniformity: Number(paragraphUniformity.toFixed(1)),
    aiRate: Number(aiRate.toFixed(1)),
    humanRate: Number((100 - aiRate).toFixed(1)),
  };
};

const buildAIDetectionReport = (project: Project, scope: 'chapter' | 'book', chapter?: Chapter): AIDetectionReport => {
  const chapters = (scope === 'chapter' && chapter ? [chapter] : project.chapters).filter(item => item.content.trim()).map(analyzeAIChapter);
  const averageAIRate = chapters.length ? chapters.reduce((sum, item) => sum + item.aiRate, 0) / chapters.length : 0;
  const level = averageAIRate < 30 ? '极低' : averageAIRate < 45 ? '低' : averageAIRate < 60 ? '中等' : '高';
  const suggestion = averageAIRate < 30 ? '文本具有较强的人类写作特征。' : averageAIRate < 45 ? '文本具有人类写作特征，可保持具体动作和口语表达。' : averageAIRate < 60 ? '文本存在混合特征，建议增加句式变化和个性化细节。' : '文本具有较多模板化特征，建议使用去 AI 味技能复写后再检测。';
  return { updatedAt: new Date().toISOString(), scope, chapters, averageAIRate: Number(averageAIRate.toFixed(1)), level, suggestion };
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const countOccurrences = (content: string, query: string) => {
  if (!query) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(query, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + Math.max(1, query.length);
  }
  return count;
};

type TabType = 'projects';
type TagTab = '主分类' | '主题' | '角色' | '情节';
type Channel = '男频' | '女频';

interface GenreTag {
  name: string;
  description?: string;
  icon: string;
  tone: string;
}

const compactTags = (items: Array<[string, string, string]>): GenreTag[] =>
  items.map(([name, icon, tone]) => ({ name, icon, tone }));

const simpleTags = (names: string[], icon = '✦', tone = 'gold'): GenreTag[] =>
  names.map(name => ({ name, icon, tone }));

const defaultProjectTags = (channel: Channel = '男频'): Record<TagTab, string[]> => ({
  主分类: [channel === '男频' ? '东方玄幻' : '女频悬疑'],
  主题: [],
  角色: [],
  情节: [],
});

const cloneProjectTags = (tags: Record<TagTab, string[]>): Record<TagTab, string[]> => ({
  主分类: [...tags.主分类],
  主题: [...tags.主题],
  角色: [...tags.角色],
  情节: [...tags.情节],
});

const maleTagCatalog: Record<TagTab, GenreTag[]> = {
  主分类: [
    { name: '东方玄幻', description: '偏东方世界观，包含玄法、奇术、神话传说', icon: '☯', tone: 'gold' },
    { name: '西方奇幻', description: '偏西方世界背景，包含魔法、骑士、精灵等', icon: '♜', tone: 'gold' },
    { name: '科幻末世', description: '末世、废土、星际、机甲、未来科技', icon: '◉', tone: 'blue' },
    { name: '男频衍生', description: '影视剧、动漫、网文世界的男频同人小说', icon: '✦', tone: 'gold' },
    { name: '都市高武', description: '都市架空，全民拥有修炼体系或超凡力量', icon: '⚡', tone: 'gold' },
    { name: '悬疑灵异', description: '男频探案、悬疑、恐怖、灵异和风水奇术', icon: '☠', tone: 'teal' },
    { name: '悬疑脑洞', description: '脑洞向的悬疑灵异、破案探险和未知谜团', icon: '⌕', tone: 'brown' },
    { name: '抗战谍战', description: '抗战时期的军事战争和间谍情报故事', icon: '◆', tone: 'green' },
    { name: '历史古代', description: '以种田、朝堂、智谋、争霸、科举等为主', icon: '▱', tone: 'green' },
    { name: '历史脑洞', description: '脑洞向历史，一般有金手指或特殊设定', icon: '◌', tone: 'teal' },
    { name: '都市种田', description: '重生年代文、职场商战、种田建设等题材', icon: '❋', tone: 'olive' },
    { name: '都市脑洞', description: '拥有金手指系统的男频都市脑洞奇想', icon: '▣', tone: 'navy' },
    { name: '都市日常', description: '都市情感、现实生活和轻日常故事', icon: '◆', tone: 'blue' },
    { name: '玄幻脑洞', description: '脑洞向玄幻，强调新奇设定和世界规则', icon: '♨', tone: 'orange' },
    { name: '战神赘婿', description: '都市向战神、兵王、赘婿逆袭文', icon: '⌁', tone: 'brown' },
    { name: '动漫衍生', description: '游戏、动漫专项同人或二次元衍生作品', icon: '✧', tone: 'peach' },
    { name: '游戏体育', description: '网游、竞技、体育及穿入游戏或世界', icon: '◎', tone: 'peach' },
    { name: '传统玄幻', description: '废柴逆袭、强者重生等传统玄幻题材', icon: '△', tone: 'teal' },
    { name: '都市修真', description: '以修真为力量体系的都市故事', icon: '◐', tone: 'olive' },
  ],
  主题: compactTags([
    ['衍生', '◫', 'gold'], ['仕途', '♟', 'gray'], ['综影视', '▰', 'gold'], ['天灾', '⚠', 'gold'],
    ['第一人称', 'Ⅰ', 'gold'], ['赛博朋克', '◉', 'navy'], ['第四天灾', 'Ⅳ', 'gold'], ['规则怪谈', '?', 'teal'],
    ['搞笑轻松', '☺', 'peach'], ['古代', '◒', 'gray'], ['悬疑', '●', 'red'], ['克苏鲁', '〰', 'navy'],
    ['都市异能', '⚡', 'purple'], ['末日求生', '☠', 'red'], ['灵气复苏', '✦', 'green'], ['高武世界', '拳', 'green'],
    ['异世大陆', '✣', 'blue'], ['东方玄幻', '龙', 'peach'], ['谍战', '➤', 'blue'], ['清朝', '帽', 'orange'],
    ['宋朝', '宋', 'coral'], ['断层', '山', 'brown'], ['武将', '将', 'teal'], ['国运', '鼎', 'red'],
    ['综漫', '漫', 'yellow'], ['开局', '剑', 'navy'], ['架空', '◉', 'blue'], ['奇幻仙侠', '剑', 'navy'],
    ['都市', '城', 'gold'], ['玄幻', '山', 'teal'], ['历史', '卷', 'green'], ['体育', '🏋', 'purple'], ['武侠', '鹤', 'gray'],
  ]),
  角色: compactTags([
    ['多女主', '女', 'peach'], ['赘婿', '婿', 'yellow'], ['全能', '◫', 'gold'], ['大佬', '鞋', 'purple'],
    ['大小姐', '花', 'coral'], ['特工', '人', 'teal'], ['游戏主播', '游', 'green'], ['神探', '探', 'brown'],
    ['宫廷侯爵', '宫', 'gold'], ['皇帝', '帝', 'brown'], ['单女主', '女', 'coral'], ['校花', '校', 'peach'],
    ['无女主', '无', 'teal'], ['女帝', '后', 'brown'], ['特种兵', '枪', 'teal'], ['反派', '影', 'navy'],
    ['神医', '诊', 'green'], ['奶爸', '奶', 'orange'], ['学霸', '100', 'brown'], ['天才', '脑', 'teal'],
    ['腹黑', '黑', 'purple'], ['扮猪吃虎', '猪', 'orange'],
  ]),
  情节: compactTags([
    ['都市江湖', '◫', 'gold'], ['风水秘术', '卦', 'gold'], ['斩神衍生', '◫', 'gold'], ['十日衍生', '◫', 'gold'],
    ['西游衍生', '游', 'brown'], ['公版衍生', '◫', 'gold'], ['红楼衍生', '◫', 'gold'], ['甄嬛衍生', '◫', 'gold'],
    ['如懿衍生', '◫', 'gold'], ['惊悚游戏', '惊', 'gold'], ['卡牌', '牌', 'gold'], ['山海经', '山', 'gold'],
    ['捉鬼', '鬼', 'gold'], ['剑修', '剑', 'gold'], ['废土', '土', 'gold'], ['副本', '本', 'gold'],
    ['黑科技', '科', 'gold'], ['无脑爽', '爽', 'gold'], ['魂穿', '魂', 'gold'], ['高手下山', '山', 'gold'],
    ['黑化', '黑', 'gold'], ['迪化', '迪', 'gold'], ['发家致富', '富', 'gold'], ['无后宫', '无', 'gold'],
    ['争霸', '争', 'gold'], ['1v1', '1', 'gold'], ['升级流', '↑', 'gold'], ['灵魂互换', '换', 'teal'],
    ['科举', '卷', 'gold'], ['封神', '神', 'gold'], ['四合院', '院', 'orange'], ['电竞', '竞', 'teal'],
    ['双重生', '双', 'blue'], ['乡村', '田', 'yellow'], ['同人', '同', 'yellow'], ['打脸', '掌', 'brown'],
    ['破案', '案', 'green'], ['囤物资', '箱', 'coral'], ['钓鱼', '鱼', 'olive'], ['网游', '剑', 'navy'],
    ['奥特同人', '奥', 'blue'], ['求生', '帐', 'green'], ['无敌', '拳', 'yellow'], ['九叔', '符', 'red'],
    ['穿书', '书', 'purple'], ['聊天群', '群', 'green'], ['大秦', '秦', 'red'], ['龙珠', '珠', 'green'],
    ['漫威', '盾', 'navy'], ['神奇宝贝', '球', 'blue'], ['海贼', '帽', 'blue'], ['火影', '忍', 'navy'],
    ['职场', '包', 'brown'], ['明朝', '明', 'gold'], ['家庭', '家', 'blue'], ['三国', '马', 'gold'],
    ['末世', '火', 'orange'], ['直播', '播', 'blue'], ['无限流', '∞', 'teal'], ['诸天万界', '界', 'olive'],
    ['大唐', '唐', 'brown'], ['宠物', '宠', 'brown'], ['外卖', '送', 'olive'], ['星际', '星', 'navy'],
    ['美食', '食', 'coral'], ['剑道', '刀', 'purple'], ['盗墓', '墓', 'gray'], ['灵异', '灵', 'green'],
    ['鉴宝', '镜', 'teal'], ['系统', '图', 'gold'], ['神豪', '钱', 'olive'], ['重生', '蝶', 'orange'],
    ['穿越', '穿', 'teal'], ['二次元', '笔', 'olive'], ['海岛', '岛', 'blue'], ['娱乐圈', '娱', 'gray'],
    ['空间', '空', 'coral'], ['推理', '帽', 'brown'], ['洪荒', '荒', 'orange'],
  ]),
};

const femaleTagCatalog: Record<TagTab, GenreTag[]> = {
  主分类: [
    { name: '女频悬疑', description: '以女性视角为主，讲述悬疑、探案和灵异故事', icon: '⌕', tone: 'red' },
    { name: '古风世情', description: '女频历史、权谋以及原生土著的古风故事', icon: '卷', tone: 'gold' },
    { name: '科幻末世', description: '末世、丧尸、星际、机甲与未来科技', icon: '◉', tone: 'blue' },
    { name: '女频衍生', description: '影视剧或古籍女频同人小说', icon: '✦', tone: 'gold' },
    { name: '青春甜宠', description: '校园题材，可甜可酸，青春成长', icon: '花', tone: 'coral' },
    { name: '双男主', description: '讲述两位男性主角之间的故事', icon: '双', tone: 'blue' },
    { name: '古言脑洞', description: '含金手指、系统或特殊设定的古言故事', icon: '古', tone: 'blue' },
    { name: '现言脑洞', description: '含系统、读心术等非现实元素的现言故事', icon: '今', tone: 'purple' },
    { name: '玄幻言情', description: '玄幻、修真、御兽等幻想言情故事', icon: '幻', tone: 'olive' },
    { name: '宫斗宅斗', description: '古代后宫、宅院与家族斗争', icon: '宫', tone: 'brown' },
    { name: '豪门总裁', description: '豪门、总裁、先婚后爱等都市情感故事', icon: '楼', tone: 'teal' },
    { name: '动漫衍生', description: '游戏、动漫等二次元方向的同人作品', icon: '漫', tone: 'peach' },
    { name: '星光璀璨', description: '娱乐圈、明星、综艺、恋综与直播故事', icon: '◆', tone: 'blue' },
    { name: '游戏体育', description: '网游、竞技、体育及穿入游戏世界', icon: '◎', tone: 'orange' },
    { name: '职场婚恋', description: '职场、婚姻生活与现实情感故事', icon: '职', tone: 'coral' },
    { name: '双女主', description: '讲述两位女性主角之间的故事', icon: '双', tone: 'navy' },
    { name: '年代', description: '穿越年代、重生年代与时代生活', icon: '年', tone: 'purple' },
    { name: '种田', description: '种田、空间、灵泉、逃荒与经营建设', icon: '田', tone: 'orange' },
    { name: '快穿', description: '主角穿越多个小世界完成任务', icon: '⌛', tone: 'teal' },
  ],
  主题: simpleTags([
    '古言权谋', '悬疑恋爱', '纯爱', '衍生', '仕途', '综影视', '天灾', '第一人称', '赛博朋克', '规则怪谈',
    '搞笑轻松', '古代', '悬疑', '谍战', '职场商战', '虐恋情深', '日久生情', '豪门世家', '综漫', '异世穿越',
    '独宠', '现代言情', '古代言情', '幻想言情', '武侠',
  ], '✦', 'coral'),
  角色: simpleTags([
    '位尊权重', '总裁', '忠犬', '全能', '白切黑', '双学霸', '作精', '大佬', '大小姐', '游戏主播',
    '神探', '将军', '毒医', '厨娘', '律师', '医生', '明星', '替身', '双面', '冰山', '古灵精怪',
    '天作之合', '可盐可甜', '无CP', '病娇', '反派', '萌宝', '宠妻', '学霸', '公主', '皇后', '王妃',
    '女强', '皇叔', '嫡女', '精灵', '天才', '腹黑', '扮猪吃虎', '团宠',
  ], '角', 'purple'),
  情节: simpleTags([
    '男二上位', '代嫁代娶', '攻略反派', '风水秘术', '斩神衍生', '十日衍生', '西游衍生', '公版衍生',
    '红楼衍生', '甄嬛衍生', '如懿衍生', '惊悚游戏', '追夫', '山海经', '胎穿', '捉鬼', '剑修',
    '相互救赎', '宠夫', '无脑爽', '魂穿', '黑化', '养崽', '年龄差', '真假千金', '久别重逢',
    '发家致富', '养成', '互宠', '1v1', '灵魂互换', '科举', '年下', '婚恋', '封神', '四合院', '电竞',
    '双重生', '前世今生', '双洁', '追妻火葬场', '乡村', '逃荒', '同人', '打脸', '破案', '囤物资',
    '钓鱼', 'HE', '相爱相杀', '暗恋', '逃婚', '带球跑', '强强', '一见钟情', '双向奔赴', '破镜重圆',
    '契约婚姻', '隐婚', '闪婚', '今穿古', '古穿今', '群穿', '护短', '虐渣', '情有独钟', '马甲',
    '先婚后爱', '医术', '女扮男装', '青梅竹马', '无敌', '民国', '穿书', '职场', '家庭', '末世',
    '直播', '无限流', '兽世', '清穿', '星际', '美食', '盗墓', '虐文', '甜宠', '灵异', '校园', '系统',
    '重生', '穿越', '二次元', '娱乐圈', '空间', '推理',
  ], '情', 'gold'),
};

const channelTagCatalog: Record<Channel, Record<TagTab, GenreTag[]>> = {
  男频: maleTagCatalog,
  女频: femaleTagCatalog,
};

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('projects');
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('projects');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 兼容旧版本项目数据：补齐章节、大纲和时间字段
          return parsed.map((project: Partial<Project>) => {
            const chapters = Array.isArray(project.chapters) ? project.chapters.map((chapter: Partial<Chapter>) => ({
              id: Number(chapter.id) || Date.now(),
              title: chapter.title ?? '未命名章节',
              content: chapter.content ?? '',
              wordCount: countNovelCharacters(chapter.content ?? ''),
              createdAt: chapter.createdAt ?? new Date().toISOString(),
              updatedAt: chapter.updatedAt ?? new Date().toISOString(),
            })) : [];
            return {
              id: Number(project.id) || Date.now(),
              title: project.title ?? '未命名小说',
              genre: project.genre ?? '玄幻',
              subgenre: project.subgenre ?? project.genre ?? '东方玄幻',
              tags: project.tags ?? {},
              cover: project.cover,
              protagonist1: project.protagonist1 ?? '',
              protagonist2: project.protagonist2 ?? '',
              synopsis: project.synopsis ?? '',
              status: project.status === 'completed' ? 'completed' : 'writing',
              wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
              chapters,
              outline: Array.isArray(project.outline) ? project.outline : [],
              outlines: Array.isArray(project.outlines) ? project.outlines : [],
              cards: Array.isArray(project.cards) ? project.cards : [],
              memories: Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : [],
              memoryDocuments: hydrateMemoryDocuments(project.memoryDocuments, Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : []),
              graphNodes: Array.isArray(project.graphNodes) ? project.graphNodes : [],
              graphEdges: Array.isArray(project.graphEdges) ? project.graphEdges : [],
              publishConfig: { ...defaultPublishConfig, ...(project.publishConfig || {}) },
              publishRecords: Array.isArray(project.publishRecords) ? project.publishRecords : [],
              chapterTargetWords: Number(project.chapterTargetWords) > 0 ? Number(project.chapterTargetWords) : 3000,
              aiDetection: project.aiDetection,
              createdAt: project.createdAt ?? project.updatedAt ?? new Date().toISOString(),
              updatedAt: project.updatedAt ?? new Date().toISOString(),
            };
          });
        }
      } catch {
        localStorage.removeItem('projects');
      }
    }
    // 没有本地项目时直接展示居中的新建入口。
    return [];
  });
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillCategoryFilter, setSkillCategoryFilter] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [deviceStorageReady, setDeviceStorageReady] = useState(false);
  
  // 模态框状态
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [projectFormMode, setProjectFormMode] = useState<'create' | 'edit'>('create');
  const [projectEditingId, setProjectEditingId] = useState<number | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showOutlineTypeModal, setShowOutlineTypeModal] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [activeTagTab, setActiveTagTab] = useState<TagTab>('主分类');
  const [tagDraft, setTagDraft] = useState<Record<TagTab, string[]>>(defaultProjectTags);
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<Project | null>(null);
  const [showNewSkillModal, setShowNewSkillModal] = useState(false);
  const [skillEditingId, setSkillEditingId] = useState<number | string | null>(null);
  const [notice, setNotice] = useState<{ title: string; content: string } | null>(null);
  
  // 编辑器状态
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editorSidebarTab, setEditorSidebarTab] = useState<'chapters' | 'outline' | 'knowledge-graph' | 'cards' | 'knowledge' | 'skills' | 'publish' | 'ai-detect'>('chapters');
  const [aiDetecting, setAIDetecting] = useState(false);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [activeOutlineId, setActiveOutlineId] = useState<number | null>(null);
  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [activeMemoryDocumentId, setActiveMemoryDocumentId] = useState<string>(memoryDocumentId('章节快照'));
  const [activeChapterMemoryId, setActiveChapterMemoryId] = useState<number | null>(null);
  const [activeGraphNodeId, setActiveGraphNodeId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<number[]>([]);
  const [cardTypeFilter, setCardTypeFilter] = useState<CardType | '全部'>('全部');
  const [cardDraft, setCardDraft] = useState<{ type: CardType; title: string; content: string }>({ type: '角色卡', title: '', content: '' });
  const [cardGenerating, setCardGenerating] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem('agent-config');
    try {
      const parsed = saved ? JSON.parse(saved) : {};
      const storedBaseURL = typeof parsed.baseURL === 'string' ? parsed.baseURL : '';
      const baseURL = !storedBaseURL || /api\.shuaiapi\.com/i.test(storedBaseURL) ? defaultBaseURL : storedBaseURL;
      return {
        serviceName: parsed.serviceName ?? '帅apiGPT0.06',
        enabled: parsed.enabled ?? true,
        apiMode: ['openai', 'responses', 'anthropic'].includes(parsed.apiMode) ? parsed.apiMode : 'openai',
        baseURL,
        apiKey: parsed.apiKey ?? (Array.isArray(parsed.apiKeys) ? parsed.apiKeys[0] ?? '' : ''),
        apiKeys: Array.isArray(parsed.apiKeys)
          ? parsed.apiKeys.filter((key: unknown): key is string => typeof key === 'string' && key.trim()).map((key: string) => key.trim())
          : (typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? [parsed.apiKey.trim()] : []),
        model: parsed.model ?? fallbackModels[0],
        contextWindow: Number(parsed.contextWindowKB ?? (Number(parsed.contextWindow) > 1024 ? Number(parsed.contextWindow) / 1024 : parsed.contextWindow)) || 128,
        reasoningMode: ['auto', 'off', 'low', 'medium', 'high', 'max', 'custom'].includes(parsed.reasoningMode) ? parsed.reasoningMode : 'auto',
        proxyEnabled: Boolean(parsed.proxyEnabled),
        proxyURL: typeof parsed.proxyURL === 'string' && parsed.proxyURL.trim() ? parsed.proxyURL : 'http://127.0.0.1:7897',
        proxyBypassLocal: parsed.proxyBypassLocal === true,
      };
    } catch {
      return { serviceName: '帅apiGPT0.06', enabled: true, apiMode: 'openai' as const, baseURL: defaultBaseURL, apiKey: '', apiKeys: [], model: fallbackModels[0], contextWindow: 128, reasoningMode: 'auto' as const, proxyEnabled: false, proxyURL: 'http://127.0.0.1:7897', proxyBypassLocal: false };
    }
  });
  const [agentInstruction, setAgentInstruction] = useState('根据当前章节上下文继续创作，保持人物设定和时间线一致，并在结尾留下自然的悬念。');
  const [agentStage, setAgentStage] = useState<AgentStage>('idle');
  const [agentDraft, setAgentDraft] = useState<AgentDraftResult | null>(null);
  const [agentError, setAgentError] = useState('');
  const [agentProgress, setAgentProgress] = useState<AgentProgressItem[]>([]);
  const [agentProgressPercent, setAgentProgressPercent] = useState(0);
  const [agentProgressMessage, setAgentProgressMessage] = useState('');
  const activeAgentRunRef = useRef('');
  const [chapterSaving, setChapterSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchScope, setSearchScope] = useState<'chapter' | 'book'>('chapter');
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [showBannedWords, setShowBannedWords] = useState(false);
  const [bannedWords, setBannedWords] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('writer-banned-words') || '[]');
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
    } catch { return []; }
  });
  const [bannedWordsDraft, setBannedWordsDraft] = useState('');
  const [writingMarksEnabled, setWritingMarksEnabled] = useState(true);
  const [chapterTargetWordsDraft, setChapterTargetWordsDraft] = useState('3000');
  const [aiToolMode, setAIToolMode] = useState<'polish' | 'continue' | null>(null);
  const [aiToolInstruction, setAIToolInstruction] = useState('');
  const [aiToolRunning, setAIToolRunning] = useState(false);
  const [aiToolResult, setAIToolResult] = useState<AIToolResult | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] = useState<{ start: number; end: number; source: string } | null>(null);
  const chapterEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const goalNoticeChapterRef = useRef<number | null>(null);
  const [publishRunning, setPublishRunning] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(agentConfig);
  const [availableModels, setAvailableModels] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('agent-models');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed.filter((model): model is string => typeof model === 'string') : fallbackModels;
    } catch {
      return fallbackModels;
    }
  });
  const [settingsModels, setSettingsModels] = useState<string[]>(availableModels);
  const [fetchedModels, setFetchedModels] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('agent-fetched-models');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((model): model is string => typeof model === 'string') : [];
    } catch {
      return [];
    }
  });
  const [customModelName, setCustomModelName] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsTesting, setModelsTesting] = useState(false);
  const [modelListMessage, setModelListMessage] = useState('');
  const [settingsServiceExpanded, setSettingsServiceExpanded] = useState(true);
  
  // 表单数据
  const [newProject, setNewProject] = useState({
    title: '',
    channel: '男频' as Channel,
    selectedTags: defaultProjectTags(),
    cover: '',
    protagonist1: '',
    protagonist2: '',
    synopsis: '',
  });
  const [projectGenerationSource, setProjectGenerationSource] = useState<'outline' | 'chapters'>('outline');
  const [projectGeneratingField, setProjectGeneratingField] = useState<'title' | 'synopsis' | null>(null);
  const [newSkill, setNewSkill] = useState({
    name: '',
    category: 'write',
    description: '',
    content: '',
    tags: '',
  });
  const [skillGenerating, setSkillGenerating] = useState(false);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AgentProgressEvent>('agent-progress', event => {
      const payload = event.payload;
      if (!payload || payload.runId !== activeAgentRunRef.current) return;
      const data = payload.data ?? {};
      if (payload.type === 'chunk' && data.text) {
        const characters = countNovelCharacters(data.text);
        setAgentProgressMessage(characters ? `正文已返回 ${characters.toLocaleString()} 字，正在整理草稿` : '正在接收模型输出');
        setAgentProgress(items => items.map(item => item.id === 'draft'
          ? { ...item, status: 'active', progress: Math.max(item.progress, 70), message: '正在接收并整理章节草稿' }
          : item));
        setAgentProgressPercent(current => Math.max(current, 70));
        return;
      }
      if (payload.type === 'complete') {
        setAgentProgressMessage(data.message || '章节草稿和一致性审查已完成');
        setAgentProgressPercent(100);
        setAgentProgress(items => items.map(item => ({ ...item, status: 'complete', progress: Math.max(item.progress, 100) })));
        return;
      }
      if (payload.type === 'error') {
        const message = data.error || '智能体运行失败';
        setAgentProgressMessage(message);
        setAgentProgress(items => {
          const activeIndex = Math.max(0, items.findIndex(item => item.status === 'active'));
          return items.map((item, index) => index === activeIndex ? { ...item, status: 'error', message } : item);
        });
        return;
      }
      if (!isAgentWorkflowStep(data.step)) return;
      const stepIndex = agentWorkflowSteps.findIndex(step => step.id === data.step);
      const progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
      setAgentStage(data.step);
      setAgentProgressMessage(data.message || agentStageLabel[data.step]);
      setAgentProgressPercent(current => Math.max(current, progress));
      setAgentProgress(items => {
        const source = items.length ? items : createAgentProgressItems();
        return source.map((item, index) => {
          if (index < stepIndex) return { ...item, status: 'complete', progress: Math.max(item.progress, 100) };
          if (item.id === data.step) return { ...item, status: 'active', progress: Math.max(item.progress, progress), message: data.message || item.description };
          return item;
        });
      });
    }).then(handler => {
      if (disposed) handler();
      else unlisten = handler;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 应用启动时预热常驻 Agent Runtime，后续智能体请求复用同一进程。
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void invoke<string>('start_agent_runtime').catch(error => {
      console.warn('Agent Runtime 预热失败，将在首次请求时重试。', error);
    });
  }, []);

  // App 启动时优先读取设备应用数据目录中的 projects.json。
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      setDeviceStorageReady(true);
      return;
    }

    invoke<Project[] | null>('load_projects')
      .then(savedProjects => {
        if (Array.isArray(savedProjects)) {
          setProjects(savedProjects.map(project => {
            const chapters = Array.isArray(project.chapters) ? project.chapters.map(chapter => ({
              ...chapter,
              wordCount: countNovelCharacters(chapter.content ?? ''),
              createdAt: chapter.createdAt ?? new Date().toISOString(),
              updatedAt: chapter.updatedAt ?? new Date().toISOString(),
            })) : [];
            return {
              ...project,
              status: project.status === 'completed' ? 'completed' : 'writing',
              chapters,
              outline: Array.isArray(project.outline) ? project.outline : [],
              outlines: Array.isArray(project.outlines) ? project.outlines : [],
              cards: Array.isArray(project.cards) ? project.cards : [],
              memories: Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : [],
              graphNodes: Array.isArray(project.graphNodes) ? project.graphNodes : [],
              graphEdges: Array.isArray(project.graphEdges) ? project.graphEdges : [],
              publishConfig: { ...defaultPublishConfig, ...(project.publishConfig || {}) },
              publishRecords: Array.isArray(project.publishRecords) ? project.publishRecords : [],
              chapterTargetWords: Number(project.chapterTargetWords) > 0 ? Number(project.chapterTargetWords) : 3000,
              aiDetection: project.aiDetection,
              memoryDocuments: hydrateMemoryDocuments(project.memoryDocuments, Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : []),
              wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
              createdAt: project.createdAt ?? project.updatedAt ?? new Date().toISOString(),
              updatedAt: project.updatedAt ?? new Date().toISOString(),
            };
          }));
        }
      })
      .catch(error => {
        setNotice({ title: '读取本地小说失败', content: String(error) });
      })
      .finally(() => setDeviceStorageReady(true));
  }, []);

  // 编辑时做短暂防抖，随后原子写入设备本地文件；网页调试环境保留 localStorage 回退。
  useEffect(() => {
    if (!deviceStorageReady) return;
    const timer = window.setTimeout(() => {
      setAutoSaveStatus('saving');
      if ('__TAURI_INTERNALS__' in window) {
        invoke<string>('save_projects', { projects })
          .then(() => { localStorage.removeItem('projects'); setAutoSaveStatus('saved'); })
          .catch(error => { setAutoSaveStatus('error'); setNotice({ title: '保存本地小说失败', content: String(error) }); });
      } else {
        localStorage.setItem('projects', JSON.stringify(projects));
        setAutoSaveStatus('saved');
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [projects, deviceStorageReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!editingProject) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void persistCurrentChapter();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setShowSearchPanel(true);
        setSearchScope('chapter');
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingProject, activeChapter, chapterSaving]);

  useEffect(() => {
    if (editingProject) {
      void loadSkills();
    }
  }, [activeTab, editingProject?.id]);

  useEffect(() => {
    localStorage.setItem('agent-config', JSON.stringify(agentConfig));
  }, [agentConfig]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const saved = localStorage.getItem('writer-skills');
      const stored = saved ? JSON.parse(saved) : [];
      const records = Array.isArray(stored) ? stored.filter((skill): skill is Skill => Boolean(skill && typeof skill.name === 'string')) : [];
      const builtinOverrides = records.filter(skill => skill.builtin).map(skill => ({
        ...skill,
        builtin: true,
        content: typeof skill.content === 'string' ? skill.content : '',
        tags: Array.isArray(skill.tags) ? skill.tags : [],
        rating: Number(skill.rating) || 0,
        usageCount: Number(skill.usageCount) || 0,
      }));
      const customSkills = records.filter(skill => !skill.builtin).map(skill => ({
        ...skill,
        content: typeof skill.content === 'string' ? skill.content : '',
        tags: Array.isArray(skill.tags) ? skill.tags : [],
        rating: Number(skill.rating) || 0,
        usageCount: Number(skill.usageCount) || 0,
      }));
      const mergedBuiltins = builtinSkills.map(skill => {
        const override = builtinOverrides.find(item => String(item.id) === String(skill.id));
        return override ? { ...skill, ...override, builtin: true } : skill;
      });
      setSkills([...mergedBuiltins, ...customSkills]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = () => {
    if (!newProject.title.trim()) {
      alert('请输入小说标题');
      return;
    }
    
    const now = new Date().toISOString();
    const existingProject = projectEditingId === null ? undefined : projects.find(project => project.id === projectEditingId);
    if (existingProject) {
      const updatedProject: Project = {
        ...existingProject,
        title: newProject.title.trim(),
        genre: newProject.channel,
        subgenre: newProject.selectedTags.主分类[0] ?? existingProject.subgenre,
        tags: cloneProjectTags(newProject.selectedTags),
        cover: newProject.cover || undefined,
        protagonist1: newProject.protagonist1.trim(),
        protagonist2: newProject.protagonist2.trim(),
        synopsis: newProject.synopsis.trim(),
        updatedAt: now,
      };
      setProjects(current => current.map(project => project.id === updatedProject.id ? updatedProject : project));
      if (editingProject?.id === updatedProject.id) setEditingProject(updatedProject);
      resetProjectForm();
      setShowNewProjectModal(false);
      setNotice({ title: '小说信息已更新', content: `《${updatedProject.title}》的基础信息已保存。` });
      return;
    }

    const project: Project = {
      id: Date.now(),
      title: newProject.title.trim(),
      genre: newProject.channel,
      subgenre: newProject.selectedTags.主分类[0],
      tags: cloneProjectTags(newProject.selectedTags),
      cover: newProject.cover || undefined,
      protagonist1: newProject.protagonist1.trim(),
      protagonist2: newProject.protagonist2.trim(),
      synopsis: newProject.synopsis.trim(),
      status: 'writing',
      wordCount: 0,
      chapters: [],
      outline: [],
      outlines: [],
      cards: [],
      memories: [],
      memoryDocuments: [],
      graphNodes: [],
      graphEdges: [],
      publishConfig: { ...defaultPublishConfig },
      publishRecords: [],
      chapterTargetWords: 3000,
      createdAt: now,
      updatedAt: now,
    };
    
    setProjects(current => [...current, project]);
    resetProjectForm();
    setShowNewProjectModal(false);
  };

  const resetProjectForm = () => {
    setNewProject({
      title: '',
      channel: '男频' as Channel,
      selectedTags: defaultProjectTags(),
      cover: '',
      protagonist1: '',
      protagonist2: '',
      synopsis: '',
    });
    setProjectGenerationSource('outline');
    setProjectGeneratingField(null);
    setProjectFormMode('create');
    setProjectEditingId(null);
  };

  const openNewProjectModal = () => {
    resetProjectForm();
    setShowNewProjectModal(true);
  };

  const openProjectEdit = (project: Project) => {
    const channel: Channel = project.genre === '女频' ? '女频' : '男频';
    const selectedTags: Record<TagTab, string[]> = {
      主分类: [...(project.tags?.主分类?.length ? project.tags.主分类 : [project.subgenre ?? (channel === '男频' ? '东方玄幻' : '女频悬疑')])],
      主题: [...(project.tags?.主题 ?? [])],
      角色: [...(project.tags?.角色 ?? [])],
      情节: [...(project.tags?.情节 ?? [])],
    };
    setProjectFormMode('edit');
    setProjectEditingId(project.id);
    setNewProject({
      title: project.title,
      channel,
      selectedTags,
      cover: project.cover ?? '',
      protagonist1: project.protagonist1 ?? '',
      protagonist2: project.protagonist2 ?? '',
      synopsis: project.synopsis ?? '',
    });
    setTagDraft(selectedTags);
    setActiveTagTab('主分类');
    setProjectGenerationSource(project.outlines.some(outline => outline.content.trim()) ? 'outline' : 'chapters');
    setProjectGeneratingField(null);
    setShowNewProjectModal(true);
  };

  const generateProjectField = async (field: 'title' | 'synopsis') => {
    if (projectGeneratingField) return;
    if (!agentConfig.enabled || !agentConfig.apiKey.trim()) {
      setNotice({ title: '需要 API Key', content: '请先在设置中填写 API Saver Key，再生成书名或作品简介。' });
      return;
    }
    const sourceProject = projectEditingId === null ? undefined : projects.find(project => project.id === projectEditingId);
    const outlines = projectGenerationSource === 'outline'
      ? (sourceProject?.outlines ?? []).filter(outline => outline.content.trim()).map(outline => ({ kind: outline.kind, title: outline.title, content: outline.content.slice(0, 5000) }))
      : [];
    const chapters = projectGenerationSource === 'chapters'
      ? (sourceProject?.chapters ?? []).filter(chapter => chapter.content.trim()).slice(0, 3).map(chapter => ({ title: chapter.title, content: chapter.content.slice(0, 4500) }))
      : [];
    setProjectGeneratingField(field);
    try {
      await invoke<string>('start_agent_runtime');
      const result = await invoke<{ title?: string; synopsis?: string }>('call_agent_rpc', {
        method: 'project.generate',
        params: {
          field,
          source: projectGenerationSource,
          title: newProject.title.trim(),
          synopsis: newProject.synopsis.trim(),
          channel: newProject.channel,
          tags: newProject.selectedTags,
          protagonist1: newProject.protagonist1.trim(),
          protagonist2: newProject.protagonist2.trim(),
          outlines,
          chapters,
          apiKey: agentConfig.apiKey.trim(),
          apiKeys: agentConfig.apiKeys,
          baseURL: agentConfig.baseURL.trim() || defaultBaseURL,
          model: agentConfig.model.trim() || fallbackModels[0],
          apiMode: agentConfig.apiMode,
          reasoningMode: agentConfig.reasoningMode,
          contextWindow: agentConfig.contextWindow,
          ...agentNetworkParams(agentConfig),
        },
      });
      if (field === 'title') {
        const title = Array.from((result.title || '').replace(/[《》“”"'`]/gu, '').trim()).slice(0, 15).join('');
        if (!title) throw new Error('智能体没有返回可用书名');
        setNewProject(current => ({ ...current, title }));
      } else {
        const synopsis = Array.from((result.synopsis || '').trim()).slice(0, 500).join('');
        if (!synopsis) throw new Error('智能体没有返回作品简介');
        setNewProject(current => ({ ...current, synopsis }));
      }
      const sourceLabel = projectGenerationSource === 'outline' ? '作品大纲' : '前 3 章内容';
      setNotice({ title: field === 'title' ? 'AI 书名已生成' : 'AI 作品简介已生成', content: `已根据${sourceLabel}回填草稿，可继续修改后保存。` });
    } catch (error) {
      setNotice({ title: field === 'title' ? '书名生成失败' : '作品简介生成失败', content: String(error) });
    } finally {
      setProjectGeneratingField(null);
    }
  };

  const openProjectTagPicker = () => {
    setTagDraft(cloneProjectTags(newProject.selectedTags));
    setActiveTagTab('主分类');
    setShowTagPicker(true);
  };

  const handleChannelChange = (channel: Channel) => {
    setNewProject(current => ({
      ...current,
      channel,
      selectedTags: defaultProjectTags(channel),
    }));
  };

  const handleCoverChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice({ title: '封面格式不支持', content: '请选择 JPG、PNG 或 WebP 图片。' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNotice({ title: '封面文件过大', content: '请选择小于 10MB 的图片。' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 480;
        const maxHeight = 640;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setNewProject(current => ({ ...current, cover: canvas.toDataURL('image/jpeg', 0.82) }));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleProjectTagToggle = (tag: string) => {
    const selected = tagDraft[activeTagTab];
    const next = activeTagTab === '主分类'
      ? [tag]
      : selected.includes(tag)
        ? selected.filter(item => item !== tag)
        : selected.length < 2
          ? [...selected, tag]
          : selected;
    setTagDraft({ ...tagDraft, [activeTagTab]: next });
  };

  const confirmProjectTags = () => {
    setNewProject({ ...newProject, selectedTags: cloneProjectTags(tagDraft) });
    setShowTagPicker(false);
  };

  const handleDeleteProject = () => {
    if (!projectPendingDeletion) return;
    const deletedId = projectPendingDeletion.id;
    setProjects(prev => prev.filter(project => project.id !== deletedId));
    if (editingProject?.id === deletedId) {
      setEditingProject(null);
      setActiveChapter(null);
      setEditorSidebarTab('chapters');
    }
    setProjectPendingDeletion(null);
  };

  const handleOpenProjectLocation = async (project: Project) => {
    try {
      await invoke<string>('save_projects', { projects });
      const path = await invoke<string>('open_project_location', { projectId: project.id });
      setNotice({ title: '已打开小说目录', content: path });
    } catch (error) {
      setNotice({ title: '打开小说目录失败', content: String(error) });
    }
  };

  const handleOpenChapterLocation = async (chapter: Chapter) => {
    if (!editingProject) return;
    try {
      await invoke<string>('save_projects', { projects });
      await invoke<string>('open_chapter_location', { projectId: editingProject.id, chapterTitle: chapter.title });
    } catch (error) {
      setNotice({ title: '打开章节位置失败', content: String(error) });
    }
  };

  const handleOpenOutlineLocation = async () => {
    if (!editingProject) return;
    try {
      await invoke<string>('save_projects', { projects });
      await invoke<string>('open_outline_location', { projectId: editingProject.id, outlineTitle: activeOutline?.title ?? '大纲' });
    } catch (error) {
      setNotice({ title: '打开大纲位置失败', content: String(error) });
    }
  };

  const handleOpenCardLocation = async (card: KnowledgeCard) => {
    if (!editingProject) return;
    try {
      await invoke<string>('save_projects', { projects });
      await invoke<string>('open_card_location', { projectId: editingProject.id, cardType: card.type, cardTitle: card.title });
    } catch (error) {
      setNotice({ title: '打开卡片位置失败', content: String(error) });
    }
  };

  const persistSkillRecords = (nextSkills: Skill[]) => {
    const records = nextSkills.filter(skill => !skill.builtin || builtinSkills.some(item => String(item.id) === String(skill.id)))
      .map(skill => ({ ...skill, ...(skill.builtin ? { builtin: true } : { builtin: false }) }));
    localStorage.setItem('writer-skills', JSON.stringify(records));
  };

  const openNewSkill = () => {
    setSkillEditingId(null);
    setNewSkill({ name: '', category: 'write', description: '', content: '', tags: '' });
    setShowNewSkillModal(true);
  };

  const openSkillEditor = (skill: Skill) => {
    setSkillEditingId(skill.id);
    setNewSkill({
      name: skill.name,
      category: skill.category,
      description: skill.description,
      content: skill.content,
      tags: skill.tags.join(', '),
    });
    setShowNewSkillModal(true);
  };

  const handleCreateSkill = () => {
    if (!newSkill.name.trim() || !newSkill.content.trim()) {
      setNotice({ title: '技能信息不完整', content: '请填写技能名称和详细内容。' });
      return;
    }
    const editingSkill = skillEditingId === null ? null : skills.find(item => String(item.id) === String(skillEditingId));
    const skill: Skill = {
      id: editingSkill?.id ?? Date.now(),
      name: newSkill.name.trim(),
      category: newSkill.category,
      description: newSkill.description.trim(),
      tags: newSkill.tags.split(',').map(t => t.trim()).filter(Boolean),
      rating: editingSkill?.rating ?? 0,
      usageCount: editingSkill?.usageCount ?? 0,
      content: newSkill.content.trim(),
      builtin: editingSkill?.builtin ?? false,
    };
    const nextSkills = editingSkill
      ? skills.map(item => String(item.id) === String(skillEditingId) ? skill : item)
      : [...skills, skill];
    persistSkillRecords(nextSkills);
    setSkills(nextSkills);
    setNewSkill({
      name: '',
      category: 'write',
      description: '',
      content: '',
      tags: '',
    });
    setSkillEditingId(null);
    setShowNewSkillModal(false);
    setNotice({ title: editingSkill ? '技能已更新' : '技能已创建', content: `${skill.name} 已保存到本机技能库。` });
  };

  const generateSkillWithAI = async () => {
    if (skillGenerating) return;
    if (!agentConfig.enabled || !agentConfig.apiKey.trim()) {
      setNotice({ title: '需要 API Key', content: '请先在设置中配置可用模型，再生成技能。' });
      return;
    }
    if (!newSkill.name.trim() && !newSkill.description.trim() && !newSkill.content.trim()) {
      setNotice({ title: '需要技能需求', content: '请先填写技能名称、用途或草稿内容。' });
      return;
    }
    setSkillGenerating(true);
    try {
      await invoke<string>('start_agent_runtime');
      const result = await invoke<{ name?: string; category?: string; description?: string; content?: string; tags?: string[] }>('call_agent_rpc', {
        method: 'skill.write',
        params: {
          name: newSkill.name.trim(),
          category: newSkill.category,
          description: newSkill.description.trim(),
          content: newSkill.content.trim(),
          tags: newSkill.tags.split(',').map(tag => tag.trim()).filter(Boolean),
          apiKey: agentConfig.apiKey.trim(),
          apiKeys: agentConfig.apiKeys,
          baseURL: agentConfig.baseURL.trim() || defaultBaseURL,
          model: agentConfig.model.trim() || fallbackModels[0],
          apiMode: agentConfig.apiMode,
          reasoningMode: agentConfig.reasoningMode,
          contextWindow: agentConfig.contextWindow,
          ...agentNetworkParams(agentConfig),
        },
      });
      setNewSkill(current => ({
        ...current,
        name: result.name?.trim() || current.name,
        category: result.category?.trim() || current.category,
        description: result.description?.trim() || current.description,
        content: result.content?.trim() || current.content,
        tags: Array.isArray(result.tags) && result.tags.length ? result.tags.join(', ') : current.tags,
      }));
      setNotice({ title: '技能草稿已生成', content: '请检查技能步骤和输出契约后保存。' });
    } catch (error) {
      setNotice({ title: '技能生成失败', content: String(error) });
    } finally {
      setSkillGenerating(false);
    }
  };

  const deleteSkill = (skill: Skill) => {
    if (skill.builtin) {
      const nextSkills = skills.filter(item => String(item.id) !== String(skill.id));
      const restored = builtinSkills.find(item => String(item.id) === String(skill.id));
      if (!restored) return;
      const next = [...nextSkills, restored].sort((left, right) => (left.builtin ? 0 : 1) - (right.builtin ? 0 : 1));
      persistSkillRecords(next.filter(item => !(item.builtin && String(item.id) === String(skill.id))));
      setSkills(next);
      setNotice({ title: '内置技能已恢复', content: `${restored.name} 已恢复为默认内容。` });
      return;
    }
    const nextSkills = skills.filter(item => String(item.id) !== String(skill.id));
    persistSkillRecords(nextSkills);
    setSkills(nextSkills);
    setNotice({ title: '技能已删除', content: `${skill.name} 已从本机技能库移除。` });
  };

  const handleEditProject = (projectId: number) => {
    const project = projects.find(p => p.id === projectId);
    if (project) {
      setChapterTargetWordsDraft(String(Number(project.chapterTargetWords) || 3000));
      setSearchQuery('');
      setReplaceQuery('');
      setSearchMatchIndex(0);
      setSelectionSnapshot(null);
      setAIToolResult(null);
      setAIToolMode(null);
      const chapters = Array.isArray(project.chapters) ? project.chapters : [];
      // 如果项目没有章节，自动创建第一章
      if (chapters.length === 0) {
        const firstChapter: Chapter = {
          id: Date.now(),
          title: '第 1 章',
          content: '',
          wordCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const updatedProject = {
          ...project,
          chapters: [firstChapter],
          outline: Array.isArray(project.outline) ? project.outline : [],
          outlines: Array.isArray(project.outlines) ? project.outlines : [],
          cards: Array.isArray(project.cards) ? project.cards : [],
          memories: Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : [],
          memoryDocuments: hydrateMemoryDocuments(project.memoryDocuments, Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : []),
          graphNodes: Array.isArray(project.graphNodes) ? project.graphNodes : [],
          graphEdges: Array.isArray(project.graphEdges) ? project.graphEdges : [],
        };
        setProjects(prev => prev.map(p => p.id === projectId ? updatedProject : p));
        setEditingProject(updatedProject);
        setActiveChapter(firstChapter);
        setActiveOutlineId(updatedProject.outlines[0]?.id ?? null);
        setSelectedCardIds([]);
        setActiveChapterMemoryId(updatedProject.memories[0]?.id ?? null);
        setSelectedMemoryIds(recentMemoryIds(updatedProject.memories));
      } else {
        const normalizedProject = {
          ...project,
          chapters,
          outline: Array.isArray(project.outline) ? project.outline : [],
          outlines: Array.isArray(project.outlines) ? project.outlines : [],
          cards: Array.isArray(project.cards) ? project.cards : [],
          memories: Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : [],
          memoryDocuments: hydrateMemoryDocuments(project.memoryDocuments, Array.isArray(project.memories) ? project.memories.map(memory => normalizeChapterMemory(memory)) : []),
          graphNodes: Array.isArray(project.graphNodes) ? project.graphNodes : [],
          graphEdges: Array.isArray(project.graphEdges) ? project.graphEdges : [],
        };
        setEditingProject(normalizedProject);
        setActiveChapter(chapters[0]);
        setActiveOutlineId(normalizedProject.outlines[0]?.id ?? null);
        setSelectedCardIds([]);
        setActiveChapterMemoryId(normalizedProject.memories[0]?.id ?? null);
        setSelectedMemoryIds(recentMemoryIds(normalizedProject.memories));
      }
    }
  };

  const handleCloseEditor = () => {
    setEditingProject(null);
    setActiveChapter(null);
    setEditorSidebarTab('chapters');
    setActiveOutlineId(null);
    setActiveCardId(null);
    setSelectedCardIds([]);
    setActiveChapterMemoryId(null);
    setSelectedMemoryIds([]);
  };

  const handleAddChapter = () => {
    if (!editingProject) return;
    const newChapter: Chapter = {
      id: Date.now(),
      title: `第 ${editingProject.chapters.length + 1} 章`,
      content: '',
      wordCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = { ...editingProject, chapters: [...editingProject.chapters, newChapter] };
    setEditingProject(updated);
    setProjects(projects.map(p => p.id === updated.id ? updated : p));
    setActiveChapter(newChapter);
    setSelectedMemoryIds(recentMemoryIds(updated.memories, 1));
  };

  const handleUpdateChapterContent = (content: string) => {
    if (!activeChapter || !editingProject) return;
    const wordCount = countNovelCharacters(content);
    const updatedChapter = { ...activeChapter, content, wordCount, updatedAt: new Date().toISOString() };
    const updatedChapters = editingProject.chapters.map(c => c.id === activeChapter.id ? updatedChapter : c);
    const totalWords = updatedChapters.reduce((sum, c) => sum + c.wordCount, 0);
    const updated = { ...editingProject, chapters: updatedChapters, wordCount: totalWords, updatedAt: new Date().toISOString() };
    setEditingProject(updated);
    setActiveChapter(updatedChapter);
    setProjects(current => current.map(p => p.id === updated.id ? updated : p));
    setAutoSaveStatus('saving');
    const target = Number(editingProject.chapterTargetWords) || 3000;
    if (wordCount >= target && goalNoticeChapterRef.current !== activeChapter.id) {
      goalNoticeChapterRef.current = activeChapter.id;
      setNotice({ title: '已达到本章目标字数', content: `本章已写 ${wordCount} 字，建议保存并创建下一章。` });
    }
  };

  const captureChapterSelection = () => {
    const element = chapterEditorRef.current;
    if (!element || !activeChapter) return;
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    if (end > start) setSelectionSnapshot({ start, end, source: activeChapter.content.slice(start, end) });
  };

  const focusSearchMatch = (direction: 1 | -1 = 1) => {
    if (!activeChapter || !searchQuery) return;
    const matches: number[] = [];
    let cursor = 0;
    while (cursor < activeChapter.content.length) {
      const index = activeChapter.content.indexOf(searchQuery, cursor);
      if (index < 0) break;
      matches.push(index);
      cursor = index + Math.max(1, searchQuery.length);
    }
    if (!matches.length) {
      setSearchMatchIndex(0);
      setNotice({ title: '没有找到匹配内容', content: `本章没有“${searchQuery}”。` });
      return;
    }
    const element = chapterEditorRef.current;
    const selectedIndex = element
      ? matches.findIndex(start => element.selectionStart === start && element.selectionEnd === start + searchQuery.length)
      : -1;
    const baseIndex = selectedIndex >= 0 ? selectedIndex : (direction === 1 ? -1 : 0);
    const nextIndex = (baseIndex + direction + matches.length) % matches.length;
    setSearchMatchIndex(nextIndex);
    window.requestAnimationFrame(() => {
      const editor = chapterEditorRef.current;
      if (!editor) return;
      const start = matches[nextIndex];
      editor.focus();
      editor.setSelectionRange(start, start + searchQuery.length);
    });
  };

  const replaceCurrentMatch = () => {
    if (!activeChapter || !searchQuery) return;
    const matches: number[] = [];
    let cursor = 0;
    while (cursor < activeChapter.content.length) {
      const index = activeChapter.content.indexOf(searchQuery, cursor);
      if (index < 0) break;
      matches.push(index);
      cursor = index + Math.max(1, searchQuery.length);
    }
    if (!matches.length) {
      setNotice({ title: '没有可替换内容', content: `本章没有“${searchQuery}”。` });
      return;
    }
    const targetStart = matches[Math.min(searchMatchIndex, matches.length - 1)];
    handleUpdateChapterContent(`${activeChapter.content.slice(0, targetStart)}${replaceQuery}${activeChapter.content.slice(targetStart + searchQuery.length)}`);
    setNotice({ title: '已替换一处', content: `已将“${searchQuery}”替换为“${replaceQuery}”。` });
  };

  const replaceAllMatches = () => {
    if (!activeChapter || !searchQuery) return;
    const count = countOccurrences(activeChapter.content, searchQuery);
    if (!count) {
      setNotice({ title: '没有可替换内容', content: `本章没有“${searchQuery}”。` });
      return;
    }
    handleUpdateChapterContent(activeChapter.content.split(searchQuery).join(replaceQuery));
    setSearchMatchIndex(0);
    setNotice({ title: '替换完成', content: `本章已替换 ${count} 处。` });
  };

  const saveBannedWords = () => {
    const words = Array.from(new Set(bannedWordsDraft.split(/[\n,，、]+/u).map(word => word.trim()).filter(Boolean))).slice(0, 300);
    setBannedWords(words);
    localStorage.setItem('writer-banned-words', JSON.stringify(words));
    setShowBannedWords(false);
    setNotice({ title: '禁词列表已保存', content: `当前共 ${words.length} 个禁词，编辑器会实时标记。` });
  };

  const copyText = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setNotice({ title: '已复制', content: '文本已复制到剪贴板。' });
    } catch {
      setNotice({ title: '复制失败', content: '当前系统未允许访问剪贴板，请手动选择文本复制。' });
    }
  };

  const runAITool = async (mode: 'polish' | 'continue') => {
    if (!editingProject || !activeChapter || aiToolRunning) return;
    if (!agentConfig.enabled || !agentConfig.apiKey.trim()) {
      setNotice({ title: '需要 API Key', content: '请先在设置中配置可用模型。' });
      return;
    }
    const target = Number(editingProject.chapterTargetWords) || 3000;
    const currentCount = countNovelCharacters(activeChapter.content);
    if (mode === 'continue') {
      const maxWords = Math.max(0, Math.floor(target * 1.2 - currentCount));
      if (!maxWords) {
        setNotice({ title: '已达到续写上限', content: `本章目标 ${target} 字，最多续写到 ${Math.floor(target * 1.2)} 字。` });
        return;
      }
      const chapterIndex = editingProject.chapters.findIndex(chapter => chapter.id === activeChapter.id);
      const previous = editingProject.chapters[chapterIndex - 1];
      if (!previous && currentCount < 200) {
        setNotice({ title: '正文太短', content: '第一章至少写满 200 字后才可以续写。' });
        return;
      }
      setAIToolResult(null);
      setAIToolMode('continue');
      setAIToolRunning(true);
      try {
        await invoke<string>('start_agent_runtime');
        const result = await invoke<{ content?: string }>('call_agent_rpc', {
          method: 'text.transform',
          params: {
            mode,
            instruction: aiToolInstruction.trim(),
            content: activeChapter.content,
            previousChapter: previous?.content?.slice(-6000) || '',
            maxWords,
            projectTitle: editingProject.title,
            chapterTitle: activeChapter.title,
            apiKey: agentConfig.apiKey.trim(), apiKeys: agentConfig.apiKeys,
            baseURL: agentConfig.baseURL.trim() || defaultBaseURL, model: agentConfig.model.trim() || fallbackModels[0],
            apiMode: agentConfig.apiMode, reasoningMode: agentConfig.reasoningMode, contextWindow: agentConfig.contextWindow, ...agentNetworkParams(agentConfig),
          },
        });
        const content = result.content?.trim() || '';
        if (!content) throw new Error('模型没有返回续写内容');
        setAIToolResult({ mode, content, maxWords });
      } catch (error) { setNotice({ title: 'AI 续写失败', content: String(error) }); }
      finally { setAIToolRunning(false); }
      return;
    }
    const element = chapterEditorRef.current;
    const start = selectionSnapshot?.start ?? element?.selectionStart ?? 0;
    const end = selectionSnapshot?.end ?? element?.selectionEnd ?? 0;
    const source = end > start ? activeChapter.content.slice(start, end) : activeChapter.content;
    if (!source.trim()) {
      setNotice({ title: '没有可润色内容', content: '请在章节中输入内容或选中一段文字。' });
      return;
    }
    setAIToolMode('polish');
    setAIToolRunning(true);
    setAIToolResult(null);
    try {
      await invoke<string>('start_agent_runtime');
      const result = await invoke<{ content?: string }>('call_agent_rpc', {
        method: 'text.transform',
        params: {
          mode, instruction: aiToolInstruction.trim(), content: source,
          projectTitle: editingProject.title, chapterTitle: activeChapter.title,
          apiKey: agentConfig.apiKey.trim(), apiKeys: agentConfig.apiKeys,
          baseURL: agentConfig.baseURL.trim() || defaultBaseURL, model: agentConfig.model.trim() || fallbackModels[0],
          apiMode: agentConfig.apiMode, reasoningMode: agentConfig.reasoningMode, contextWindow: agentConfig.contextWindow, ...agentNetworkParams(agentConfig),
        },
      });
      const content = result.content?.trim() || '';
      if (!content) throw new Error('模型没有返回润色内容');
      setAIToolResult({ mode, content, source, start, end });
    } catch (error) { setNotice({ title: 'AI 润色失败', content: String(error) }); }
    finally { setAIToolRunning(false); }
  };

  const acceptAIToolResult = () => {
    if (!aiToolResult || !activeChapter) return;
    if (aiToolResult.mode === 'continue') {
      const separator = activeChapter.content.trim() ? '\n\n' : '';
      handleUpdateChapterContent(`${activeChapter.content}${separator}${aiToolResult.content}`);
    } else if (aiToolResult.start !== undefined && aiToolResult.end !== undefined && activeChapter.content.slice(aiToolResult.start, aiToolResult.end) === aiToolResult.source) {
      handleUpdateChapterContent(`${activeChapter.content.slice(0, aiToolResult.start)}${aiToolResult.content}${activeChapter.content.slice(aiToolResult.end)}`);
    } else {
      handleUpdateChapterContent(aiToolResult.content);
    }
    setAIToolResult(null);
    setAIToolMode(null);
    setAIToolInstruction('');
    setNotice({ title: aiToolResult.mode === 'continue' ? '续写已插入章节' : '润色已写入章节', content: '内容已更新，正在自动保存。' });
  };

  const updateChapterTargetWords = () => {
    if (!editingProject) return;
    const target = Math.max(200, Math.min(100000, Number(chapterTargetWordsDraft) || 3000));
    updateEditorProject(project => ({ ...project, chapterTargetWords: target, updatedAt: new Date().toISOString() }));
    setChapterTargetWordsDraft(String(target));
    setNotice({ title: '章节目标已更新', content: `当前章节目标设为 ${target} 字，续写上限为 ${Math.floor(target * 1.2)} 字。` });
  };

  const cardSearchTerms = (card: KnowledgeCard) => {
    const generic = new Set(['角色', '物品', '地点', '势力', '金手指', '身份', '性格', '目标', '能力', '关系', '当前状态', '详细信息', '暂无', '设定']);
    const terms = new Set<string>();
    const add = (value: string) => {
      const normalized = value.trim();
      if (normalized.length >= 2 && !generic.has(normalized)) terms.add(normalized);
    };
    add(card.title);
    add(card.title.replace(/^(主角|角色|人物|本命|关键|核心)/u, ''));
    for (let size = 2; size <= Math.min(6, card.title.length); size += 1) {
      for (let start = 0; start <= card.title.length - size; start += 1) add(card.title.slice(start, start + size));
    }
    for (const segment of `${card.title}\n${card.content}`.match(/[\u3400-\u9fff]{2,10}|[A-Za-z][A-Za-z0-9_-]{1,24}/g) || []) {
      add(segment);
      if (/^[\u3400-\u9fff]+$/u.test(segment)) {
        for (let size = 2; size <= Math.min(4, segment.length); size += 1) {
          for (let start = 0; start <= segment.length - size; start += 1) add(segment.slice(start, start + size));
        }
      }
    }
    return [...terms].sort((left, right) => right.length - left.length).slice(0, 30);
  };

  const findCardRecentMentions = (project: Project, card: KnowledgeCard, limit = 3) => {
    const terms = cardSearchTerms(card);
    const mentions: Array<{ chapter: Chapter; matchedTerm: string; snippet: string; position: number }> = [];
    for (const chapter of [...project.chapters].reverse()) {
      const positions = terms.flatMap(term => {
        const found: Array<{ term: string; position: number }> = [];
        let position = chapter.content.indexOf(term);
        while (position >= 0 && found.length < 8) {
          found.push({ term, position });
          position = chapter.content.indexOf(term, position + term.length);
        }
        return found;
      }).sort((left, right) => right.position - left.position);
      for (const match of positions.slice(0, limit)) {
        const { position, term: matchedTerm } = match;
        const start = Math.max(0, position - 70);
        const end = Math.min(chapter.content.length, position + matchedTerm.length + 150);
        mentions.push({ chapter, matchedTerm, position, snippet: chapter.content.slice(start, end).replace(/\s+/gu, ' ').trim() });
      }
    }
    return mentions.slice(0, limit);
  };

  const updateCardStatesFromBook = (cardId?: number) => {
    if (!editingProject) return;
    const now = new Date().toISOString();
    const targetCards = cardId === undefined ? editingProject.cards : editingProject.cards.filter(card => card.id === cardId);
    if (!targetCards.length) return;
    updateEditorProject(project => {
      const searchProject = activeChapter
        ? { ...project, chapters: project.chapters.map(chapter => chapter.id === activeChapter.id ? activeChapter : chapter) }
        : project;
      const graphNodes = [...project.graphNodes];
      const graphEdges = [...project.graphEdges];
      project.cards.forEach(card => {
        if (!graphNodes.some(node => node.id === `card:${card.id}`)) graphNodes.push({ id: `card:${card.id}`, label: card.title, type: 'card', category: card.type });
      });
      const cards = project.cards.map(card => {
        if (!targetCards.some(target => target.id === card.id)) return card;
        let recentMentions = findCardRecentMentions(searchProject, card, 3);
        const fallbackTerm = card.title.slice(-2);
        if (!recentMentions.length && activeChapter && fallbackTerm.length === 2 && activeChapter.content.includes(fallbackTerm)) {
          const position = activeChapter.content.lastIndexOf(fallbackTerm);
          recentMentions = [{ chapter: activeChapter, matchedTerm: fallbackTerm, position, snippet: activeChapter.content.slice(Math.max(0, position - 70), position + fallbackTerm.length + 150).replace(/\s+/gu, ' ').trim() }];
        }
        const mention = recentMentions[0] ?? null;
        const status = mention ? '最近出现' : '未在正文中定位';
        const changes = mention
          ? recentMentions.map(item => `第 ${project.chapters.findIndex(chapter => chapter.id === item.chapter.id) + 1} 章《${item.chapter.title}》出现“${item.matchedTerm}”：${item.snippet}`).join('\n')
          : '当前全文未检索到可定位的卡片名称或关键词。';
        const lastEntry = card.stateHistory?.[card.stateHistory.length - 1];
        const stateHistory = lastEntry?.changes === changes ? (card.stateHistory || []) : [
          ...(card.stateHistory || []),
          { chapterId: mention?.chapter.id ?? 0, chapterTitle: mention?.chapter.title ?? '全文检索', status, changes, updatedAt: now },
        ].slice(-30);
        for (const item of recentMentions) {
          const chapterNodeId = `chapter:${item.chapter.id}`;
          if (!graphNodes.some(node => node.id === chapterNodeId)) graphNodes.push({ id: chapterNodeId, label: item.chapter.title, type: 'chapter' });
          const edgeId = `${chapterNodeId}->card:${card.id}:状态引用`;
          if (!graphEdges.some(edge => edge.id === edgeId)) graphEdges.push({ id: edgeId, source: chapterNodeId, target: `card:${card.id}`, label: '状态引用' });
        }
        return { ...card, currentState: changes, stateHistory, updatedAt: now };
      });
      return { ...project, cards, graphNodes, graphEdges, updatedAt: now };
    });
    setNotice({ title: cardId === undefined ? '卡片状态已更新' : '卡片状态已更新', content: `已全文检索并更新 ${targetCards.length} 张卡片的最近出现状态。` });
  };

  const buildProjectWithChapterMemory = (project: Project, chapter: Chapter, memoryPatch: Partial<ChapterMemory>) => {
    const hasContent = chapter.content.trim().length > 0;
    const updatedChapters = project.chapters.map(item => item.id === chapter.id ? chapter : item);
    const chapterNodeId = `chapter:${chapter.id}`;
    const chapterNumber = project.chapters.findIndex(item => item.id === chapter.id) + 1;
    const mentionedCards = project.cards.filter(card => cardSearchTerms(card).some(term => chapter.content.includes(term)) || (card.title.length >= 2 && chapter.content.includes(card.title.slice(-2))));
    const referencedCards = project.cards.filter(card => selectedCardIds.includes(card.id) || mentionedCards.some(item => item.id === card.id));
    const graphNodes = [...project.graphNodes];
    const ensureNode = (id: string, label: string, type: KnowledgeGraphNode['type'], category?: string) => {
      const index = graphNodes.findIndex(node => node.id === id);
      if (index >= 0) graphNodes[index] = { ...graphNodes[index], label, type, category: category || graphNodes[index].category };
      else graphNodes.push({ id, label, type, category });
    };
    project.cards.forEach(card => ensureNode(`card:${card.id}`, card.title, 'card', card.type));
    project.outlines.forEach(outline => ensureNode(`outline:${outline.id}`, outline.title, 'outline', outline.kind));
    [project.protagonist1, project.protagonist2].filter((name): name is string => Boolean(name?.trim())).forEach(name => ensureNode(`entity:${name.trim()}`, name.trim(), 'entity', '人物'));
    if (hasContent) ensureNode(chapterNodeId, chapter.title, 'chapter');
    else {
      const index = graphNodes.findIndex(node => node.id === chapterNodeId);
      if (index >= 0) graphNodes.splice(index, 1);
    }
    const graphEdges = project.graphEdges.filter(edge => edge.source !== chapterNodeId && edge.target !== chapterNodeId);
    if (hasContent) {
      referencedCards.forEach(card => {
        const id = `${chapterNodeId}->card:${card.id}`;
        graphEdges.push({ id, source: chapterNodeId, target: `card:${card.id}`, label: selectedCardIds.includes(card.id) ? '本章引用' : '正文提及' });
      });
      [project.protagonist1, project.protagonist2].filter((name): name is string => Boolean(name?.trim()) && chapter.content.includes(name.trim())).forEach(name => {
        const target = `entity:${name.trim()}`;
        graphEdges.push({ id: `${chapterNodeId}->${target}`, source: chapterNodeId, target, label: '章节主角' });
      });
    }
    const cards = project.cards.map(card => {
      if (!hasContent || !referencedCards.some(item => item.id === card.id)) return card;
      const matchedTerm = cardSearchTerms(card).find(term => chapter.content.includes(term)) || card.title;
      const position = chapter.content.lastIndexOf(matchedTerm);
      const snippet = position >= 0 ? chapter.content.slice(Math.max(0, position - 70), Math.min(chapter.content.length, position + matchedTerm.length + 150)).replace(/\s+/gu, ' ').trim() : '';
      const changes = `第 ${chapterNumber} 章《${chapter.title}》出现“${matchedTerm}”：${snippet}`;
      const lastEntry = card.stateHistory?.[card.stateHistory.length - 1];
      const stateHistory = lastEntry?.changes === changes ? (card.stateHistory || []) : [...(card.stateHistory || []), { chapterId: chapter.id, chapterTitle: chapter.title, status: '本章出现', changes, updatedAt: new Date().toISOString() }].slice(-30);
      return { ...card, currentState: changes, stateHistory, updatedAt: new Date().toISOString() };
    });
    const existingMemory = project.memories.find(memory => memory.chapterId === chapter.id);
    const memories = hasContent ? [
      ...project.memories.filter(memory => memory.chapterId !== chapter.id),
      normalizeChapterMemory({
        ...existingMemory,
        ...memoryPatch,
        id: existingMemory?.id ?? Date.now(),
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        createdAt: existingMemory?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceChapterNumber: project.chapters.findIndex(item => item.id === chapter.id) + 1,
      }, chapter),
    ] : project.memories.filter(memory => memory.chapterId !== chapter.id);
    return {
      ...project,
      chapters: updatedChapters,
      cards,
      wordCount: updatedChapters.reduce((sum, item) => sum + item.wordCount, 0),
      memories,
      memoryDocuments: buildMemoryDocuments(memories, project.memoryDocuments),
      graphNodes,
      graphEdges,
      updatedAt: new Date().toISOString(),
    };
  };

  // 将章节记忆 Agent 抽取的实体和关系增量合并到本地知识图谱。
  const mergeKnowledgeGraph = (project: Project, chapter: Chapter, result: AgentMemoryResult): Project => {
    const chapterNodeId = `chapter:${chapter.id}`;
    const nodes = [...project.graphNodes];
    const edges = [...project.graphEdges];
    const now = new Date().toISOString();
    let cards = project.cards;
    const findNodeId = (label: string) => nodes.find(node => node.label === label)?.id
      || project.cards.find(card => cardSearchTerms(card).includes(label))?.id.toString().replace(/^/, 'card:');
    const ensureEntity = (label: string, category = '实体') => {
      const normalized = label.trim().slice(0, 80);
      if (!normalized) return null;
      const existingId = findNodeId(normalized);
      if (existingId) return existingId;
      const id = `entity:${normalized}`;
      nodes.push({ id, label: normalized, type: 'entity', category });
      return id;
    };
    const chapterNode = nodes.find(node => node.id === chapterNodeId);
    if (!chapterNode && chapter.content.trim()) nodes.push({ id: chapterNodeId, label: chapter.title, type: 'chapter' });
    project.cards.forEach(card => {
      if (!nodes.some(node => node.id === `card:${card.id}`)) nodes.push({ id: `card:${card.id}`, label: card.title, type: 'card', category: card.type });
    });
    project.outlines.forEach(outline => {
      if (!nodes.some(node => node.id === `outline:${outline.id}`)) nodes.push({ id: `outline:${outline.id}`, label: outline.title, type: 'outline', category: outline.kind });
    });
    for (const entity of result.entities || []) {
      const id = ensureEntity(String(entity.name || ''), String(entity.type || '实体'));
      if (!id) continue;
      const edgeId = `${chapterNodeId}->${id}`;
      if (!edges.some(edge => edge.id === edgeId)) edges.push({ id: edgeId, source: chapterNodeId, target: id, label: '章节提及' });
    }
    for (const relation of result.relations || []) {
      const sourceLabel = String(relation.source || '').trim();
      const targetLabel = String(relation.target || '').trim();
      if (!sourceLabel || !targetLabel) continue;
      const source = findNodeId(sourceLabel) || ensureEntity(sourceLabel);
      const target = findNodeId(targetLabel) || ensureEntity(targetLabel);
      if (!source || !target || source === target) continue;
      const label = String(relation.label || '关联').trim().slice(0, 40) || '关联';
      const edgeId = `${source}->${target}:${label}`;
      if (!edges.some(edge => edge.id === edgeId)) edges.push({ id: edgeId, source, target, label });
    }
    for (const update of result.cardUpdates || []) {
      const card = cards.find(item => (update.cardId !== undefined && String(item.id) === String(update.cardId)) || (update.cardTitle && item.title === update.cardTitle));
      const changes = String(update.changes || '').trim();
      if (!card || !changes) continue;
      const status = String(update.status || 'updated').trim();
      const lastEntry = card.stateHistory?.[card.stateHistory.length - 1];
      const stateHistory = lastEntry?.changes === changes ? (card.stateHistory || []) : [...(card.stateHistory || []), { chapterId: chapter.id, chapterTitle: chapter.title, status, changes, updatedAt: now }].slice(-30);
      cards = cards.map(item => item.id === card.id ? { ...item, currentState: changes, stateHistory, updatedAt: now } : item);
      const cardNodeId = `card:${card.id}`;
      const edgeId = `${chapterNodeId}->${cardNodeId}:状态更新`;
      if (!edges.some(edge => edge.id === edgeId)) edges.push({ id: edgeId, source: chapterNodeId, target: cardNodeId, label: '状态更新' });
    }
    return { ...project, cards, graphNodes: nodes, graphEdges: edges, updatedAt: now };
  };

  const persistCurrentChapter = async () => {
    if (!editingProject || !activeChapter || chapterSaving) return;
    setChapterSaving(true);
    const now = new Date().toISOString();
    const chapter: Chapter = {
      ...activeChapter,
      content: activeChapter.content,
      wordCount: countNovelCharacters(activeChapter.content),
      updatedAt: now,
    };
    const currentMemory = editingProject.memories.find(memory => memory.chapterId === chapter.id);
    const selectedKeywords = editingProject.cards.filter(card => selectedCardIds.includes(card.id)).map(card => card.title);
    const keywords = selectedKeywords.length ? selectedKeywords : (currentMemory?.keywords?.length ? currentMemory.keywords : extractLocalKeywords(chapter.content));
    const localProject = buildProjectWithChapterMemory(editingProject, chapter, {
      summary: buildLocalChapterSummary(chapter.content),
      keywords,
    });
    const saveProject = async (project: Project) => {
      const snapshot = projects.map(item => item.id === project.id ? project : item);
      setProjects(snapshot);
      setEditingProject(project);
      setActiveChapter(chapter);
      if ('__TAURI_INTERNALS__' in window) {
        await invoke<string>('save_projects', { projects: snapshot });
      } else {
        localStorage.setItem('projects', JSON.stringify(snapshot));
      }
    };

    try {
      await saveProject(localProject);
    } catch (error) {
      setNotice({ title: '章节保存失败', content: String(error) });
      setChapterSaving(false);
      return;
    }

    if (localProject.publishConfig?.enabled && localProject.publishConfig.autoPublishOnSave && chapter.content.trim()) {
      void publishChapterToFanqie(chapter, localProject);
    }

    if (!chapter.content.trim() || !agentConfig.enabled || !agentConfig.apiKey.trim()) {
      setNotice({ title: '章节已保存', content: chapter.content.trim() ? '章节和本地章节记忆已更新。' : '空章节已保存，并移除了本章记忆。' });
      setChapterSaving(false);
      return;
    }

    // 本地章节已经保存，AI 记忆只处理当前章节，并在后台增量更新。
    // 这样网络中转变慢或返回 502 时不会阻塞编辑器的保存按钮。
    setChapterSaving(false);
    setNotice({ title: '章节已保存', content: '章节已写入本地，正在后台更新本章记忆。' });
    void (async () => {
      try {
        await invoke<string>('start_agent_runtime');
        const result = await invoke<AgentMemoryResult>('call_agent_rpc', {
          method: 'memory.write',
          params: {
            projectTitle: localProject.title,
            chapterTitle: chapter.title,
            content: chapter.content,
            cards: localProject.cards.filter(card => selectedCardIds.includes(card.id) || (card.title.trim() && chapter.content.includes(card.title))).slice(0, 10),
            apiKey: agentConfig.apiKey.trim(),
            apiKeys: agentConfig.apiKeys,
            baseURL: agentConfig.baseURL.trim() || defaultBaseURL,
            model: agentConfig.model.trim() || fallbackModels[0],
            apiMode: agentConfig.apiMode,
            reasoningMode: agentConfig.reasoningMode,
            contextWindow: agentConfig.contextWindow,
            knowledgeGraph: { nodes: localProject.graphNodes, edges: localProject.graphEdges },
            ...agentNetworkParams(agentConfig),
          },
        });
        const summary = result.summary?.trim() || buildLocalChapterSummary(chapter.content);
        const aiKeywords = Array.isArray(result.keywords) && result.keywords.length ? asTextList(result.keywords, 8) : keywords;
        const memoryPatch = {
          summary,
          keywords: aiKeywords,
          characterStateChanges: asTextList(result.characterStateChanges),
          knowledgeChanges: asTextList(result.knowledgeChanges),
          foreshadowingChanges: asTextList(result.foreshadowingChanges),
          timelineEvents: asTextList(result.timelineEvents),
          canonFacts: asTextList(result.canonFacts),
          conflicts: asTextList(result.conflicts),
          endingHook: typeof result.endingHook === 'string' ? result.endingHook.trim() : '',
        };
        // 如果用户在等待期间又编辑了本章，丢弃过期摘要，避免覆盖新正文。
        setProjects(currentProjects => {
          const latestProject = currentProjects.find(project => project.id === localProject.id);
          const latestChapter = latestProject?.chapters.find(item => item.id === chapter.id);
          if (!latestProject || !latestChapter || latestChapter.updatedAt !== chapter.updatedAt) return currentProjects;
          const memoryProject = buildProjectWithChapterMemory(latestProject, latestChapter, memoryPatch);
          const merged = mergeKnowledgeGraph(memoryProject, latestChapter, result);
          setEditingProject(current => current?.id === merged.id ? merged : current);
          setActiveChapter(current => current?.id === latestChapter.id ? latestChapter : current);
          const nextProjects = currentProjects.map(project => project.id === merged.id ? merged : project);
          if ('__TAURI_INTERNALS__' in window) {
            void invoke<string>('save_projects', { projects: nextProjects });
          } else {
            localStorage.setItem('projects', JSON.stringify(nextProjects));
          }
          return nextProjects;
        });
        setNotice({ title: '章节记忆更新完成', content: '本章结构化摘要已写入本地；若期间再次编辑，旧摘要会被自动丢弃。' });
      } catch (error) {
        setNotice({ title: '章节已保存', content: `本章记忆暂未更新：${String(error)}。正文和本地快照不受影响。` });
      }
    })();
  };

  const updateEditorProject = (updater: (project: Project) => Project) => {
    if (!editingProject) return;
    const updated = updater(editingProject);
    setEditingProject(updated);
    setProjects(current => current.map(project => project.id === updated.id ? updated : project));
  };

  const handleCreateOutline = (kind: OutlineKind) => {
    if (!editingProject) return;
    const now = new Date().toISOString();
    const outline: OutlineDocument = {
      id: Date.now(),
      kind,
      title: kind,
      content: `# ${kind}\n\n`,
      createdAt: now,
      updatedAt: now,
    };
    updateEditorProject(project => ({
      ...project,
      outlines: [...project.outlines, outline],
      graphNodes: [...project.graphNodes, { id: `outline:${outline.id}`, label: outline.kind, type: 'outline' }],
      updatedAt: now,
    }));
    setActiveOutlineId(outline.id);
  };

  const updateActiveOutline = (patch: Partial<OutlineDocument>) => {
    if (!editingProject || activeOutlineId === null) return;
    const now = new Date().toISOString();
    updateEditorProject(project => ({
      ...project,
      outlines: project.outlines.map(outline => outline.id === activeOutlineId ? { ...outline, ...patch, updatedAt: now } : outline),
      updatedAt: now,
    }));
  };

  const handleDeleteOutline = (id: number) => {
    if (!editingProject) return;
    updateEditorProject(project => ({
      ...project,
      outlines: project.outlines.filter(outline => outline.id !== id),
      graphNodes: project.graphNodes.filter(node => node.id !== `outline:${id}`),
      graphEdges: project.graphEdges.filter(edge => edge.source !== `outline:${id}` && edge.target !== `outline:${id}`),
      updatedAt: new Date().toISOString(),
    }));
    if (activeOutlineId === id) setActiveOutlineId(editingProject.outlines.find(outline => outline.id !== id)?.id ?? null);
  };

  const generateOutline = async () => {
    if (!editingProject || activeOutlineId === null) return;
    const outline = editingProject.outlines.find(item => item.id === activeOutlineId);
    if (!outline) return;
    if (!agentConfig.enabled || !agentConfig.apiKey.trim()) {
      setNotice({ title: '需要 API Key', content: '请先在设置中填写 API Saver Key，再生成大纲。' });
      return;
    }
    setAgentError('');
    setAgentStage('starting');
    try {
      await invoke<string>('start_agent_runtime');
      const result = await invoke<{ content?: string; title?: string }>('call_agent_rpc', {
        method: 'outline.write',
        params: {
          projectId: String(editingProject.id),
          projectTitle: editingProject.title,
          kind: outline.kind,
          existingContent: outline.content,
          synopsis: editingProject.synopsis,
          cards: editingProject.cards,
          knowledgeGraph: { nodes: editingProject.graphNodes, edges: editingProject.graphEdges },
          apiKey: agentConfig.apiKey.trim(),
          apiKeys: agentConfig.apiKeys,
          baseURL: agentConfig.baseURL.trim(),
          model: agentConfig.model.trim() || 'gpt-4o-mini',
          apiMode: agentConfig.apiMode,
          reasoningMode: agentConfig.reasoningMode,
          contextWindow: agentConfig.contextWindow,
          ...agentNetworkParams(agentConfig),
        },
      });
      updateActiveOutline({ content: result.content || outline.content });
      setAgentStage('idle');
      setNotice({ title: '大纲已生成', content: `${outline.kind} 已由智能体生成，可继续手动编辑。` });
    } catch (error) {
      setAgentStage('error');
      setAgentError(String(error));
    }
  };

  const startNewCard = () => {
    setActiveCardId(null);
    setCardDraft({ type: '角色卡', title: '', content: '' });
  };

  const editCard = (card: KnowledgeCard) => {
    setActiveCardId(card.id);
    setCardDraft({ type: card.type, title: card.title, content: card.content });
  };

  const generateCardWithAI = async () => {
    if (!editingProject || cardGenerating) return;
    if (!agentConfig.enabled || !agentConfig.apiKey.trim()) {
      setNotice({ title: '需要 API Key', content: '请先在设置中填写 API Key，再生成知识卡片。' });
      return;
    }
    setCardGenerating(true);
    try {
      await invoke<string>('start_agent_runtime');
      const result = await invoke<{ title?: string; content?: string }>('call_agent_rpc', {
        method: 'card.write',
        params: {
          projectTitle: editingProject.title,
          synopsis: editingProject.synopsis,
          cardType: cardDraft.type,
          cardTitle: cardDraft.title.trim(),
          existingContent: cardDraft.content,
          chapterTitle: activeChapter?.title,
          chapterContent: activeChapter?.content?.slice(-6000),
          outlines: editingProject.outlines.slice(-4).map(outline => ({ kind: outline.kind, content: outline.content })),
          cards: editingProject.cards.filter(card => card.id !== activeCardId).slice(-8),
          apiKey: agentConfig.apiKey.trim(),
          apiKeys: agentConfig.apiKeys,
          baseURL: agentConfig.baseURL.trim(),
          model: agentConfig.model.trim() || fallbackModels[0],
          apiMode: agentConfig.apiMode,
          reasoningMode: agentConfig.reasoningMode,
          contextWindow: agentConfig.contextWindow,
          ...agentNetworkParams(agentConfig),
        },
      });
      if (!result.content?.trim()) throw new Error('智能体没有返回卡片内容');
      setCardDraft(current => ({
        ...current,
        title: result.title?.trim() || current.title || `${current.type}设定`,
        content: result.content.trim(),
      }));
      setNotice({ title: '卡片草稿已生成', content: '内容已填入左侧编辑器，请检查后点击“保存卡片”。' });
    } catch (error) {
      setNotice({ title: '卡片生成失败', content: String(error) });
    } finally {
      setCardGenerating(false);
    }
  };

  const saveCard = () => {
    if (!editingProject || !cardDraft.title.trim() || !cardDraft.content.trim()) {
      setNotice({ title: '卡片信息不完整', content: '请填写卡片名称和详细知识内容。' });
      return;
    }
    const now = new Date().toISOString();
    const card: KnowledgeCard = {
      id: activeCardId ?? Date.now(),
      type: cardDraft.type,
      title: cardDraft.title.trim(),
      content: cardDraft.content.trim(),
      currentState: activeCardId ? editingProject.cards.find(item => item.id === activeCardId)?.currentState : undefined,
      stateHistory: activeCardId ? editingProject.cards.find(item => item.id === activeCardId)?.stateHistory : undefined,
      createdAt: activeCardId ? (editingProject.cards.find(item => item.id === activeCardId)?.createdAt ?? now) : now,
      updatedAt: now,
    };
    updateEditorProject(project => ({
      ...project,
      cards: activeCardId ? project.cards.map(item => item.id === activeCardId ? card : item) : [...project.cards, card],
      graphNodes: project.graphNodes.some(node => node.id === `card:${card.id}`)
        ? project.graphNodes.map(node => node.id === `card:${card.id}` ? { ...node, label: card.title } : node)
        : [...project.graphNodes, { id: `card:${card.id}`, label: card.title, type: 'card' }],
      updatedAt: now,
    }));
    setActiveCardId(card.id);
    setNotice({ title: '卡片已保存', content: `${card.title} 已写入本地知识库。` });
  };

  const deleteCard = (id: number) => {
    if (!editingProject) return;
    updateEditorProject(project => ({
      ...project,
      cards: project.cards.filter(card => card.id !== id),
      graphNodes: project.graphNodes.filter(node => node.id !== `card:${id}`),
      graphEdges: project.graphEdges.filter(edge => edge.source !== `card:${id}` && edge.target !== `card:${id}`),
      updatedAt: new Date().toISOString(),
    }));
    setSelectedCardIds(current => current.filter(cardId => cardId !== id));
    if (activeCardId === id) startNewCard();
  };

  const toggleCardForChapter = (id: number) => {
    setSelectedCardIds(current => current.includes(id) ? current.filter(cardId => cardId !== id) : [...current, id]);
  };

  const publishChapterToFanqie = async (chapter: Chapter | null = activeChapter, projectOverride: Project | null = editingProject) => {
    if (!chapter || !projectOverride) return;
    const config = { ...defaultPublishConfig, ...(projectOverride.publishConfig || {}) };
    if (!config.enabled) {
      setNotice({ title: '番茄发布未启用', content: '请先在发布面板启用番茄小说并保存配置。' });
      return;
    }
    if (!chapter.content.trim()) {
      setNotice({ title: '章节为空', content: '请先保存有正文的章节，再发布到番茄小说。' });
      return;
    }
    setPublishRunning(true);
    try {
      if (!('__TAURI_INTERNALS__' in window)) throw new Error('发布功能需要桌面版浏览器运行时');
      await invoke<string>('save_projects', { projects });
      const result = await invoke<{ status?: PublishRecord['status']; message?: string; url?: string }>('publish_fanqie', {
        creatorURL: config.creatorURL,
        bookId: config.bookId,
        chapterTitle: chapter.title,
        content: chapter.content,
      });
      const status = result.status || 'error';
      const record: PublishRecord = {
        id: `${projectOverride.id}:${chapter.id}:${Date.now()}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        platform: 'fanqie',
        status,
        message: result.message || '发布流程完成',
        url: result.url,
        updatedAt: new Date().toISOString(),
      };
      setProjects(current => current.map(project => project.id === projectOverride.id ? { ...project, publishRecords: [...(project.publishRecords || []), record].slice(-100), updatedAt: new Date().toISOString() } : project));
      setEditingProject(current => current?.id === projectOverride.id ? { ...current, publishRecords: [...(current.publishRecords || []), record].slice(-100), updatedAt: new Date().toISOString() } : current);
      setNotice({ title: status === 'published' ? '番茄发布成功' : '番茄发布流程完成', content: result.message || '请查看番茄创作后台状态。' });
    } catch (error) {
      setNotice({ title: '番茄发布失败', content: String(error) });
    } finally {
      setPublishRunning(false);
    }
  };

  const runAIDetection = (scope: 'chapter' | 'book') => {
    if (!editingProject) return;
    if (scope === 'chapter' && !activeChapter) {
      setNotice({ title: '请选择章节', content: '选择章节后再运行当前章节 AI 检测。' });
      return;
    }
    setAIDetecting(true);
    const report = buildAIDetectionReport(editingProject, scope, activeChapter || undefined);
    updateEditorProject(project => ({ ...project, aiDetection: report, updatedAt: report.updatedAt }));
    setAIDetecting(false);
    setNotice({ title: 'AI 检测完成', content: `已分析 ${report.chapters.length} 个章节，预估 AI 率 ${report.averageAIRate}%。` });
  };

  const runChapterAgent = async () => {
    if (!editingProject || !activeChapter || agentRunning(agentStage)) return;
    if (!agentConfig.enabled || !agentConfig.apiKey.trim()) {
      setAgentError('请先填写 API Saver Key');
      setAgentStage('error');
      return;
    }
    const runId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeAgentRunRef.current = runId;
    setAgentError('');
    setAgentDraft(null);
    setAgentStage('starting');
    setAgentProgress(createAgentProgressItems().map((item, index) => index === 0
      ? { ...item, status: 'active', progress: 1, message: '正在启动 Agent Runtime' }
      : item));
    setAgentProgressPercent(1);
    setAgentProgressMessage('正在启动 Agent Runtime');
    let agentSkills = skills;
    if (!agentSkills.length) {
      try {
        const saved = JSON.parse(localStorage.getItem('writer-skills') || '[]');
        const customSkills = Array.isArray(saved) ? saved.filter((skill): skill is Skill => Boolean(skill && typeof skill.name === 'string' && !skill.builtin)) : [];
        agentSkills = [...builtinSkills, ...customSkills];
      } catch {
        agentSkills = builtinSkills;
      }
    }
    const activeChapterIndex = editingProject.chapters.findIndex(chapter => chapter.id === activeChapter.id);
    const continuityChapter = activeChapterIndex > 0 ? editingProject.chapters[activeChapterIndex - 1] : null;
    try {
      await invoke<string>('start_agent_runtime');
      setAgentProgress(items => items.map(item => item.id === 'starting'
        ? { ...item, status: 'active', progress: Math.max(item.progress, 2), message: '运行环境已就绪，正在发送创作任务' }
        : item));
      setAgentProgressPercent(current => Math.max(current, 2));
      setAgentProgressMessage('运行环境已就绪，正在发送创作任务');
      const result = await invoke<AgentDraftResult>('call_agent_rpc', {
        method: 'chapter.write',
        params: {
          runId,
          projectId: String(editingProject.id),
          projectTitle: editingProject.title,
          chapterId: String(activeChapter.id),
          instruction: agentInstruction,
          outlines: editingProject.outlines.map(outline => ({ id: outline.id, kind: outline.kind, title: outline.title, content: outline.content })),
          activeOutlineId,
          outline: editingProject.outlines.length
            ? editingProject.outlines.map(outline => `## ${outline.kind}\n${outline.content}`).join('\n\n')
            : (editingProject.outline.length ? JSON.stringify(editingProject.outline) : ''),
          cards: editingProject.cards.filter(card => selectedCardIds.includes(card.id)),
          knowledgeGraph: { nodes: editingProject.graphNodes, edges: editingProject.graphEdges },
          skills: agentSkills.map(skill => ({ name: skill.name, category: skill.category, description: skill.description, tags: skill.tags, content: skill.content })),
          // 章节承接只传入紧邻上一章正文；更早章节只通过用户勾选的结构化记忆进入。
          previousChapters: continuityChapter ? [{ id: continuityChapter.id, title: continuityChapter.title, content: continuityChapter.content }] : [],
          memories: editingProject.memories.filter(memory => selectedMemoryIds.includes(memory.id)).map(memory => ({
            id: memory.id,
            title: memory.chapterTitle,
            summary: memory.summary,
            keywords: memory.keywords,
            characterStateChanges: memory.characterStateChanges,
            knowledgeChanges: memory.knowledgeChanges,
            foreshadowingChanges: memory.foreshadowingChanges,
            timelineEvents: memory.timelineEvents,
            canonFacts: memory.canonFacts,
            conflicts: memory.conflicts,
            endingHook: memory.endingHook,
          })),
          memoryDocuments: [],
          apiKey: agentConfig.apiKey.trim(),
          apiKeys: agentConfig.apiKeys,
          baseURL: agentConfig.baseURL.trim(),
          model: agentConfig.model.trim() || 'gpt-4o-mini',
          apiMode: agentConfig.apiMode,
          reasoningMode: agentConfig.reasoningMode,
          contextWindow: agentConfig.contextWindow,
          ...agentNetworkParams(agentConfig),
        },
      });
      setAgentDraft(result);
      setAgentStage('done');
      setAgentProgressPercent(100);
      setAgentProgressMessage('章节草稿和一致性审查已完成');
      setAgentProgress(items => items.map(item => ({ ...item, status: 'complete', progress: Math.max(item.progress, 100) })));
    } catch (error) {
      const message = String(error);
      setAgentError(message);
      setAgentStage('error');
      setAgentProgressMessage(message);
      setAgentProgress(items => {
        const activeIndex = Math.max(0, items.findIndex(item => item.status === 'active'));
        return items.map((item, index) => index === activeIndex ? { ...item, status: 'error', message } : item);
      });
    }
  };

  const acceptAgentDraft = () => {
    if (!agentDraft?.draftContent) return;
    if (editingProject && activeChapter) {
      const now = new Date().toISOString();
      const updatedChapter: Chapter = {
        ...activeChapter,
        content: agentDraft.draftContent,
        wordCount: countNovelCharacters(agentDraft.draftContent),
        updatedAt: now,
      };
      const selectedCards = editingProject.cards.filter(card => selectedCardIds.includes(card.id));
      const updated = buildProjectWithChapterMemory(editingProject, updatedChapter, {
        summary: agentDraft.summary || buildLocalChapterSummary(agentDraft.draftContent),
        keywords: selectedCards.map(card => card.title),
      });
      setEditingProject(updated);
      setActiveChapter(updatedChapter);
      setProjects(current => current.map(project => project.id === updated.id ? updated : project));
    }
    setAgentDraft(null);
    setAgentStage('idle');
    setAgentProgress([]);
    setAgentProgressPercent(0);
    setAgentProgressMessage('');
    activeAgentRunRef.current = '';
  };

  const openSettings = () => {
    setSettingsDraft(agentConfig);
    setSettingsModels(availableModels);
    setCustomModelName('');
    setCustomApiKey('');
    setModelListMessage('');
    setSettingsServiceExpanded(true);
    setShowSettingsModal(true);
  };

  const pullModels = async () => {
    if (!settingsDraft.apiKey.trim()) {
      setNotice({ title: '需要 API Key', content: '请先填写 API Key，再拉取模型列表。' });
      return;
    }
    setModelsLoading(true);
    try {
      await invoke<string>('start_agent_runtime');
      const result = await invoke<{ models?: string[] }>('call_agent_rpc', {
        method: 'models.list',
        params: { baseURL: settingsDraft.baseURL.trim(), apiKey: settingsDraft.apiKey.trim(), apiKeys: settingsDraft.apiKeys, apiMode: settingsDraft.apiMode, ...agentNetworkParams(settingsDraft) },
      });
      const models = Array.isArray(result.models) ? result.models.filter((model): model is string => typeof model === 'string' && Boolean(model)) : [];
      if (models.length === 0) throw new Error('接口没有返回可用模型');
      setFetchedModels(models);
      localStorage.setItem('agent-fetched-models', JSON.stringify(models));
      setModelListMessage(`已获取 ${models.length} 个模型${settingsDraft.proxyEnabled ? `，请求已通过代理 ${settingsDraft.proxyURL}` : ''}，点击模型即可加入启用列表。`);
    } catch (error) {
      setModelListMessage(`拉取模型失败：${String(error)}`);
    } finally {
      setModelsLoading(false);
    }
  };

  const testSelectedModel = async () => {
    if (!settingsDraft.apiKey.trim()) {
      setModelListMessage('请先填写 API 密钥，再测试模型。');
      return;
    }
    setModelsTesting(true);
    setModelListMessage('正在测试当前模型...');
    try {
      await invoke<string>('start_agent_runtime');
      await invoke('call_agent_rpc', {
        method: 'models.test',
        params: {
          apiKey: settingsDraft.apiKey.trim(),
          apiKeys: settingsDraft.apiKeys,
          baseURL: settingsDraft.baseURL.trim(),
          apiMode: settingsDraft.apiMode,
          model: settingsDraft.model.trim() || fallbackModels[0],
          reasoningMode: settingsDraft.reasoningMode,
          contextWindow: settingsDraft.contextWindow,
          ...agentNetworkParams(settingsDraft),
        },
      });
      setModelListMessage(`模型 ${settingsDraft.model || fallbackModels[0]} 测试成功${settingsDraft.proxyEnabled ? `，已通过代理 ${settingsDraft.proxyURL}` : ''}。`);
    } catch (error) {
      setModelListMessage(`模型测试失败：${String(error)}`);
    } finally {
      setModelsTesting(false);
    }
  };

  const useSystemProxy = async () => {
    try {
      const detected = await invoke<string | null>('detect_system_proxy');
      if (!detected) {
        setModelListMessage('没有检测到系统 HTTP/HTTPS 代理，请手动填写代理地址。');
        return;
      }
      setSettingsDraft(current => ({ ...current, proxyEnabled: true, proxyURL: detected }));
      setModelListMessage(`已读取系统代理 ${detected}，保存设置后生效。`);
    } catch (error) {
      setModelListMessage(`读取系统代理失败：${String(error)}`);
    }
  };

  const toggleSettingsModel = (model: string) => {
    setSettingsModels(current => {
      if (current.includes(model)) {
        if (current.length === 1) return current;
        const next = current.filter(item => item !== model);
        setSettingsDraft(draft => draft.model === model ? { ...draft, model: next[0] } : draft);
        return next;
      }
      return [...current, model];
    });
  };

  const addCustomModel = () => {
    const model = customModelName.trim();
    if (!model) return;
    setSettingsModels(current => Array.from(new Set([...current, model])));
    setSettingsDraft(current => ({ ...current, model: current.model || model }));
    setCustomModelName('');
  };

  const addSettingsModel = (model: string) => {
    const normalized = model.trim();
    if (!normalized) return;
    setSettingsModels(current => Array.from(new Set([...current, normalized])));
    setSettingsDraft(current => ({ ...current, model: current.model || normalized }));
  };

  const updatePrimaryApiKey = (apiKey: string) => {
    setSettingsDraft(current => {
      const keys = current.apiKeys?.length ? [...current.apiKeys] : [];
      if (keys.length) keys[0] = apiKey;
      else if (apiKey.trim()) keys.push(apiKey);
      return { ...current, apiKey, apiKeys: keys };
    });
  };

  const addApiKey = () => {
    const key = customApiKey.trim();
    if (!key) return;
    setSettingsDraft(current => {
      const keys = Array.from(new Set([...(current.apiKeys || []), key]));
      return { ...current, apiKey: current.apiKey.trim() || keys[0], apiKeys: keys };
    });
    setCustomApiKey('');
  };

  const removeApiKey = (index: number) => {
    setSettingsDraft(current => {
      const keys = (current.apiKeys || []).filter((_, itemIndex) => itemIndex !== index);
      return { ...current, apiKey: keys[0] || '', apiKeys: keys };
    });
  };

  const saveSettings = () => {
    if (settingsDraft.proxyEnabled) {
      try {
        const proxyURL = new URL(settingsDraft.proxyURL.trim());
        if (!['http:', 'https:'].includes(proxyURL.protocol)) throw new Error('仅支持 HTTP/HTTPS 代理');
      } catch (error) {
        setModelListMessage(`代理地址无效：${error instanceof Error ? error.message : '请填写完整的 http:// 或 https:// 地址'}`);
        return;
      }
    }
    const enabledModels = settingsModels.length ? settingsModels : [settingsDraft.model || fallbackModels[0]];
    const selectedModel = enabledModels.includes(settingsDraft.model) ? settingsDraft.model : enabledModels[0];
    setAvailableModels(enabledModels);
    localStorage.setItem('agent-models', JSON.stringify(enabledModels));
    setAgentConfig({
      ...settingsDraft,
      serviceName: settingsDraft.serviceName.trim() || '帅apiGPT0.06',
      baseURL: settingsDraft.baseURL.trim() || defaultBaseURL,
      apiKey: (settingsDraft.apiKeys?.[0] || settingsDraft.apiKey).trim(),
      apiKeys: Array.from(new Set((settingsDraft.apiKeys?.length ? settingsDraft.apiKeys : [settingsDraft.apiKey]).map(key => key.trim()).filter(Boolean))),
      model: selectedModel,
      contextWindow: Math.max(16, Number(settingsDraft.contextWindow) || 128),
    });
    setAgentError('');
    setAgentStage('idle');
    setShowSettingsModal(false);
    setNotice({ title: '设置已保存', content: 'API 地址、模型和 Key 已保存到本机。' });
  };

  const chooseOutlineType = (kind: OutlineKind) => {
    handleCreateOutline(kind);
    setShowOutlineTypeModal(false);
  };

  const updateMemoryDocument = (id: string, content: string) => {
    updateEditorProject(project => ({
      ...project,
      memoryDocuments: project.memoryDocuments.map(document => document.id === id
        ? { ...document, content, manuallyEdited: true, updatedAt: new Date().toISOString() }
        : document),
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateChapterMemory = (patch: Partial<ChapterMemory>) => {
    if (!editingProject || activeChapterMemoryId === null) return;
    const memories = editingProject.memories.map(memory => memory.id === activeChapterMemoryId
      ? normalizeChapterMemory({ ...memory, ...patch, updatedAt: new Date().toISOString() })
      : memory);
    updateEditorProject(project => ({
      ...project,
      memories,
      memoryDocuments: buildMemoryDocuments(memories, project.memoryDocuments),
      updatedAt: new Date().toISOString(),
    }));
  };

  const saveActiveChapterMemory = async () => {
    if (!editingProject || activeChapterMemoryId === null) return;
    const memories = editingProject.memories.map(memory => memory.id === activeChapterMemoryId
      ? { ...memory, updatedAt: new Date().toISOString() }
      : memory);
    const updatedProject = {
      ...editingProject,
      memories,
      memoryDocuments: buildMemoryDocuments(memories, editingProject.memoryDocuments),
      updatedAt: new Date().toISOString(),
    };
    const snapshot = projects.map(item => item.id === updatedProject.id ? updatedProject : item);
    setEditingProject(updatedProject);
    setProjects(snapshot);
    try {
      if ('__TAURI_INTERNALS__' in window) {
        await invoke<string>('save_projects', { projects: snapshot });
      } else {
        localStorage.setItem('projects', JSON.stringify(snapshot));
      }
      setNotice({ title: '本章记忆已保存', content: '结构化章节快照和聚合记忆已写入本地。' });
    } catch (error) {
      setNotice({ title: '本章记忆保存失败', content: String(error) });
    }
  };

  const saveActiveMemoryDocument = async () => {
    if (!editingProject) return;
    const document = editingProject.memoryDocuments.find(item => item.id === activeMemoryDocumentId);
    if (!document) return;
    const updatedProject = {
      ...editingProject,
      memoryDocuments: editingProject.memoryDocuments.map(item => item.id === document.id
        ? { ...item, updatedAt: new Date().toISOString() }
        : item),
      updatedAt: new Date().toISOString(),
    };
    const snapshot = projects.map(item => item.id === updatedProject.id ? updatedProject : item);
    setEditingProject(updatedProject);
    setProjects(snapshot);
    try {
      if ('__TAURI_INTERNALS__' in window) {
        await invoke<string>('save_projects', { projects: snapshot });
      } else {
        localStorage.setItem('projects', JSON.stringify(snapshot));
      }
      setNotice({ title: '记忆已保存', content: `《${document.title}》已写入本地记忆目录。` });
    } catch (error) {
      setNotice({ title: '记忆保存失败', content: String(error) });
    }
  };

  const rebuildMemoryDocuments = () => {
    if (!editingProject) return;
    const now = new Date().toISOString();
    const updated = {
      ...editingProject,
      memoryDocuments: buildMemoryDocuments(editingProject.memories, editingProject.memoryDocuments, true)
        .map(document => ({ ...document, updatedAt: now })),
      updatedAt: now,
    };
    setEditingProject(updated);
    setProjects(current => current.map(project => project.id === updated.id ? updated : project));
    setNotice({ title: '记忆已重新整理', content: '已按全部章节快照重建人物状态、伏笔、时间线和设定事实。' });
  };

  const activeOutline = editingProject?.outlines.find(outline => outline.id === activeOutlineId) ?? null;
  const activeCard = editingProject?.cards.find(card => card.id === activeCardId) ?? null;
  const activeMemoryDocument = editingProject?.memoryDocuments.find(document => document.id === activeMemoryDocumentId) ?? null;
  const activeChapterMemory = editingProject?.memories.find(memory => memory.id === activeChapterMemoryId) ?? null;
  const activeGraphNode = editingProject?.graphNodes.find(node => node.id === activeGraphNodeId) ?? null;
  const visibleCards = editingProject?.cards.filter(card => cardTypeFilter === '全部' || card.type === cardTypeFilter) ?? [];
  const characterNames = editingProject ? Array.from(new Set([
    ...(editingProject.protagonist1 || '').split(/[、,，/\s]+/u),
    ...(editingProject.protagonist2 || '').split(/[、,，/\s]+/u),
    ...editingProject.cards.filter(card => card.type === '角色卡').map(card => card.title),
  ].map(item => item.trim()).filter(item => item.length > 1))) : [];
  const markTerms = Array.from(new Set([...characterNames, ...bannedWords].filter(Boolean))).sort((left, right) => right.length - left.length);
  const renderMarkedContent = (content: string) => {
    if (!writingMarksEnabled || !content || !markTerms.length) return content || '\u200b';
    const pattern = new RegExp(`(${markTerms.map(escapeRegExp).join('|')})`, 'gu');
    return content.split(pattern).map((part, index) => {
      if (!part) return null;
      const isBanned = bannedWords.includes(part);
      const isCharacter = characterNames.includes(part);
      return isBanned || isCharacter
        ? <mark key={`${part}-${index}`} className={isBanned ? 'banned-word-mark' : 'character-mark'}>{part}</mark>
        : <span key={`${part}-${index}`}>{part}</span>;
    });
  };
  const currentSearchMatches = activeChapter && searchQuery ? countOccurrences(activeChapter.content, searchQuery) : 0;
  const bookSearchResults = editingProject && searchScope === 'book' && searchQuery.trim()
    ? editingProject.chapters.filter(chapter => chapter.title.includes(searchQuery) || chapter.content.includes(searchQuery)).map(chapter => ({ chapter, count: countOccurrences(`${chapter.title}\n${chapter.content}`, searchQuery) }))
    : [];
  const graphLayout = (() => {
    const nodes = editingProject?.graphNodes ?? [];
    const edges = editingProject?.graphEdges ?? [];
    if (!nodes.length) return [];
    const positions = nodes.map((node, index) => {
      const angle = index * 2.399963229728653;
      const radius = 0.18 + 0.27 * Math.sqrt(index / Math.max(nodes.length - 1, 1));
      return { id: node.id, x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
    });
    const byId = new Map(positions.map(position => [position.id, position]));
    for (let iteration = 0; iteration < 65; iteration += 1) {
      for (let left = 0; left < positions.length; left += 1) {
        for (let right = left + 1; right < positions.length; right += 1) {
          const first = positions[left]; const second = positions[right];
          const dx = first.x - second.x; const dy = first.y - second.y;
          const distance = Math.max(0.025, Math.hypot(dx, dy));
          const force = Math.min(0.018, 0.0019 / (distance * distance));
          first.x += dx / distance * force; first.y += dy / distance * force;
          second.x -= dx / distance * force; second.y -= dy / distance * force;
        }
      }
      for (const edge of edges) {
        const source = byId.get(edge.source); const target = byId.get(edge.target);
        if (!source || !target) continue;
        const dx = target.x - source.x; const dy = target.y - source.y;
        const distance = Math.max(0.025, Math.hypot(dx, dy));
        const force = (distance - 0.18) * 0.035;
        source.x += dx / distance * force; source.y += dy / distance * force;
        target.x -= dx / distance * force; target.y -= dy / distance * force;
      }
      positions.forEach(position => {
        position.x = Math.max(0.05, Math.min(0.95, position.x + (0.5 - position.x) * 0.004));
        position.y = Math.max(0.07, Math.min(0.93, position.y + (0.5 - position.y) * 0.004));
      });
    }
    return positions.map(position => ({
      ...position,
      x: 5 + position.x * 90,
      y: 6 + position.y * 88,
      degree: edges.filter(edge => edge.source === position.id || edge.target === position.id).length,
    }));
  })();
  const visibleSkills = skills.filter(skill => {
    const matchesCategory = !skillCategoryFilter || skill.category === skillCategoryFilter;
    const query = skillSearch.trim().toLowerCase();
    return matchesCategory && (!query || `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase().includes(query));
  });

  return (
    <div className="app">
      {editingProject ? (
        <div className="editor-view">
          <header className="editor-header">
            <button className="btn-back" onClick={handleCloseEditor}>← 返回</button>
            <h2>{editingProject.title}</h2>
            <button className="editor-tool-button" title="搜索章节与全文" onClick={() => { setShowSearchPanel(true); window.setTimeout(() => searchInputRef.current?.focus(), 0); }}>搜索</button>
            <button className={`editor-tool-button ${writingMarksEnabled ? 'active' : ''}`} title="人物名称与禁词标记" onClick={() => setWritingMarksEnabled(current => !current)}>标记</button>
            <button className="editor-tool-button" title="编辑禁词列表" onClick={() => { setBannedWordsDraft(bannedWords.join('\n')); setShowBannedWords(true); }}>禁词</button>
            <button className="btn-primary editor-save-button" disabled={!activeChapter || chapterSaving} onClick={persistCurrentChapter}>{chapterSaving ? '保存中...' : '保存章节'}</button>
            <div className="editor-stats">
              <span>{autoSaveStatus === 'saving' ? '自动保存中' : autoSaveStatus === 'saved' ? '已自动保存' : autoSaveStatus === 'error' ? '保存失败' : '本地写作'}</span>
              <span>{editingProject.chapters.length} 章</span>
            </div>
          </header>

          {notice && (
            <div className="editor-notice" role="status" aria-live="polite">
              <div className="editor-notice-copy">
                <strong>{notice.title}</strong>
                <span>{notice.content}</span>
              </div>
              <button className="editor-notice-close" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
            </div>
          )}

          {showBannedWords && (
            <div className="editor-popover" role="dialog" aria-modal="true" aria-label="自定义禁词列表">
              <div className="editor-popover-header"><strong>禁词提示</strong><button className="icon-delete" title="关闭" onClick={() => setShowBannedWords(false)}>×</button></div>
              <p>每行一个，或用逗号分隔。写作时会以红色波浪线标记。</p>
              <textarea value={bannedWordsDraft} onChange={event => setBannedWordsDraft(event.target.value)} placeholder="输入需要提示的禁词" />
              <div><button className="btn-secondary" onClick={() => setShowBannedWords(false)}>取消</button><button className="btn-primary" onClick={saveBannedWords}>保存列表</button></div>
            </div>
          )}

          <div className="editor-body">
            <aside className="editor-sidebar">
              <div className="editor-sidebar-tabs">
                <button
                  className={editorSidebarTab === 'chapters' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('chapters')}
                >
                  章节
                </button>
                <button
                  className={editorSidebarTab === 'outline' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('outline')}
                >
                  大纲
                </button>
                <button
                  className={editorSidebarTab === 'knowledge-graph' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('knowledge-graph')}
                >
                  知识图谱 <small>{editingProject.graphEdges.length}</small>
                </button>
                <button
                  className={editorSidebarTab === 'cards' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('cards')}
                >
                  卡片
                </button>
                <button
                  className={editorSidebarTab === 'knowledge' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('knowledge')}
                >
                  记忆中心
                </button>
                <button
                  className={editorSidebarTab === 'skills' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('skills')}
                >
                  技能
                </button>
                <button
                  className={editorSidebarTab === 'publish' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('publish')}
                >
                  发布
                </button>
                <button
                  className={editorSidebarTab === 'ai-detect' ? 'active' : ''}
                  onClick={() => setEditorSidebarTab('ai-detect')}
                >
                  AI 检测
                </button>
              </div>

              {editorSidebarTab === 'publish' && (() => {
                const publishConfig = { ...defaultPublishConfig, ...(editingProject.publishConfig || {}) };
                const publishRecords = editingProject.publishRecords || [];
                return <div className="publish-panel">
                  <div className="panel-section-title">自动发布 <span>仅支持番茄小说</span></div>
                  <label className="publish-platform-row"><span>发布平台</span><select className="select" value={publishConfig.platform} disabled><option value="fanqie">番茄小说</option></select></label>
                  <label className="publish-switch-row"><span>启用番茄发布</span><input type="checkbox" checked={publishConfig.enabled} onChange={(event) => updateEditorProject(project => ({ ...project, publishConfig: { ...publishConfig, enabled: event.target.checked } }))} /></label>
                  <label>番茄创作后台地址<input className="input" value={publishConfig.creatorURL} onChange={(event) => updateEditorProject(project => ({ ...project, publishConfig: { ...publishConfig, creatorURL: event.target.value } }))} /></label>
                  <label>作品 ID <small>可选，用于直接定位作品</small><input className="input" value={publishConfig.bookId} placeholder="番茄后台作品 ID" onChange={(event) => updateEditorProject(project => ({ ...project, publishConfig: { ...publishConfig, bookId: event.target.value } }))} /></label>
                  <label className="publish-switch-row"><span>保存章节后自动发布</span><input type="checkbox" checked={publishConfig.autoPublishOnSave} onChange={(event) => updateEditorProject(project => ({ ...project, publishConfig: { ...publishConfig, autoPublishOnSave: event.target.checked } }))} /></label>
                  <button className="btn-primary publish-button" disabled={publishRunning || !activeChapter} onClick={() => publishChapterToFanqie()}>{publishRunning ? '发布中...' : '发布当前章节'}</button>
                  <p className="publish-hint">首次发布会打开持久化浏览器窗口，请先登录番茄创作后台；登录状态只保存在本机浏览器配置中。</p>
                  <div className="publish-records"><div className="panel-section-title">发布记录 <span>{publishRecords.length}</span></div>{publishRecords.length === 0 ? <p className="empty-hint compact">暂无发布记录</p> : [...publishRecords].reverse().slice(0, 8).map(record => <div className="publish-record" key={record.id}><div><strong>{record.chapterTitle}</strong><small>{record.message}</small></div><span className={`publish-status ${record.status}`}>{record.status === 'published' ? '已发布' : record.status === 'login_required' ? '待登录' : record.status === 'prepared' ? '待确认' : '需处理'}</span></div>)}</div>
                </div>;
              })()}

              {editorSidebarTab === 'ai-detect' && (() => {
                const report = editingProject.aiDetection;
                return <div className="ai-detection-panel">
                  <div className="panel-section-title">AI 内容检测 <span>本地分析</span></div>
                  <p className="ai-detection-hint">参考句子、逻辑词、口语化、心理描写和段落均匀度特征估算，不调用外部检测 API。</p>
                  <div className="ai-detection-actions"><button className="btn-secondary" disabled={aiDetecting || !activeChapter} onClick={() => runAIDetection('chapter')}>检测当前章</button><button className="btn-primary" disabled={aiDetecting} onClick={() => runAIDetection('book')}>检测全书</button></div>
                  {report ? <>
                    <div className="ai-detection-summary"><strong>{report.averageAIRate}%</strong><span>预估 AI 率 · {report.level}</span><small>{report.suggestion}</small></div>
                    <div className="ai-detection-metrics"><span>句子均匀度 {report.chapters.length === 1 ? `${report.chapters[0].sentenceUniformity}%` : '按章节查看'}</span><span>口语化 {report.chapters.length === 1 ? `${report.chapters[0].colloquialFrequency}/百字` : '按章节查看'}</span><span>逻辑词 {report.chapters.length === 1 ? `${report.chapters[0].logicFrequency}/百字` : '按章节查看'}</span></div>
                    <div className="ai-detection-list">{report.chapters.map(item => <div className="ai-detection-item" key={item.chapterId}><div><strong>{item.chapterTitle}</strong><small>{item.wordCount} 字 · 句子均匀度 {item.sentenceUniformity}%</small></div><b className={item.aiRate >= 60 ? 'high' : item.aiRate >= 45 ? 'medium' : 'low'}>{item.aiRate}%</b></div>)}</div>
                    <small className="ai-detection-updated">更新于 {new Date(report.updatedAt).toLocaleString()}</small>
                  </> : <p className="empty-hint compact">尚未检测，选择当前章或全书开始分析。</p>}
                </div>;
              })()}

              {editorSidebarTab === 'skills' && (
                <div className="skills-panel editor-skills-panel">
                  <div className="panel-section-title">写作技能 <span>{skills.length}</span></div>
                  <div className="skills-panel-toolbar">
                    <select className="select" value={skillCategoryFilter} onChange={(event) => setSkillCategoryFilter(event.target.value)}>
                      <option value="">全部分类</option><option value="setup">项目设置</option><option value="write">写作</option><option value="review">审查</option><option value="polish">润色</option><option value="import">导入</option><option value="analyze">分析</option><option value="tool">工具</option><option value="creator">创建器</option>
                    </select>
                    <button className="btn-add-chapter" onClick={openNewSkill}>+ 新建</button>
                  </div>
                  <input type="search" className="input skills-panel-search" placeholder="搜索技能" value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} />
                  <div className="editor-skill-list">
                    {visibleSkills.map(skill => (
                      <div className="editor-skill-item" key={skill.id}>
                        <div className="editor-skill-copy"><strong>{skill.name}</strong><small>{skill.builtin ? '内置' : '自定义'} · {skill.category}</small><p>{skill.description}</p></div>
                        <div className="editor-skill-actions"><button className="link-button" onClick={() => openSkillEditor(skill)}>查看 / 编辑</button><button className="link-button danger-link" onClick={() => deleteSkill(skill)}>{skill.builtin ? '恢复默认' : '删除'}</button></div>
                        <details className="editor-skill-content"><summary>查看内容</summary><pre>{skill.content}</pre></details>
                      </div>
                    ))}
                    {!visibleSkills.length && <p className="empty-hint">没有匹配的技能。</p>}
                  </div>
                  <button className="btn-secondary skills-reset-button" onClick={() => { void loadSkills(); setNotice({ title: '技能已刷新', content: '已重新读取内置技能和本机自定义技能。' }); }}>刷新技能</button>
                </div>
              )}

              {editorSidebarTab === 'chapters' && (
                <div className="chapters-panel">
                  <div className="project-writing-stats">
                    <strong>{editingProject.wordCount.toLocaleString()} <small>总字数</small></strong>
                    <span>{editingProject.chapters.length} 章</span>
                  </div>
                  <div className="chapter-target-row">
                    <label htmlFor="chapter-target-words">本章目标</label>
                    <input id="chapter-target-words" className="input" type="number" min="200" step="100" value={chapterTargetWordsDraft} onChange={event => setChapterTargetWordsDraft(event.target.value)} onBlur={updateChapterTargetWords} />
                    <span>字</span>
                  </div>
                  <button className="btn-add-chapter" onClick={handleAddChapter}>+ 新建章节</button>
                  <div className="chapters-list">
                    {editingProject.chapters.map(chapter => (
                      <div
                        key={chapter.id}
                        className={`chapter-item ${activeChapter?.id === chapter.id ? 'active' : ''}`}
                        onClick={() => { setActiveChapter(chapter); setSelectionSnapshot(null); setSearchMatchIndex(0); goalNoticeChapterRef.current = null; }}
                      >
                        <div className="chapter-copy">
                          <div className="chapter-title">{chapter.title}</div>
                          <div className="chapter-meta">{chapter.wordCount} 字</div>
                        </div>
                        <button
                          className="chapter-location-button"
                          title="打开章节文件所在位置"
                          aria-label={`打开${chapter.title}文件所在位置`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenChapterLocation(chapter);
                          }}
                        >打开位置</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {editorSidebarTab === 'outline' && (
                <div className="outline-panel">
                  <div className="panel-toolbar outline-toolbar">
                    <button className="btn-add-chapter" onClick={() => setShowOutlineTypeModal(true)}>+ 新建大纲</button>
                    <button className="outline-location-button" onClick={handleOpenOutlineLocation}>打开位置</button>
                  </div>
                  <div className="outline-document-list">
                    {editingProject.outlines.map(outline => (
                      <div key={outline.id} className={`outline-document-item ${activeOutlineId === outline.id ? 'active' : ''}`} onClick={() => setActiveOutlineId(outline.id)}>
                        <div><strong>{outline.kind}</strong><small>{outline.title}</small></div>
                        <button className="icon-delete" title="删除大纲" onClick={(event) => { event.stopPropagation(); handleDeleteOutline(outline.id); }}>×</button>
                      </div>
                    ))}
                  </div>
                  {activeOutline ? (
                    <div className="outline-editor">
                      <input className="input" value={activeOutline.title} onChange={(event) => updateActiveOutline({ title: event.target.value })} />
                      <textarea className="outline-content-editor" value={activeOutline.content} onChange={(event) => updateActiveOutline({ content: event.target.value })} placeholder={`编辑${activeOutline.kind}内容...`} />
                      <button className="btn-primary" onClick={generateOutline}>AI 生成大纲</button>
                    </div>
                  ) : <p className="empty-hint">点击“新建大纲”，再选择总纲、细纲或设定文档</p>}
                </div>
              )}

              {editorSidebarTab === 'cards' && (
                <div className="cards-panel">
                  <div className="panel-toolbar">
                    <select className="select" value={cardTypeFilter} onChange={(event) => setCardTypeFilter(event.target.value as CardType | '全部')}>
                      <option value="全部">全部卡片</option>
                      <option value="角色卡">角色卡</option>
                      <option value="物品卡">物品卡</option>
                      <option value="地点卡">地点卡</option>
                      <option value="势力卡">势力卡</option>
                      <option value="金手指卡">金手指卡</option>
                    </select>
                    <button className="btn-add-chapter" onClick={startNewCard}>+ 新建</button>
                    <button className="btn-secondary" onClick={() => updateCardStatesFromBook()}>一键更新状态</button>
                  </div>
                  <div className="card-list">
                    {visibleCards.map(card => (
                      <div key={card.id} className={`knowledge-card-item ${activeCardId === card.id ? 'active' : ''}`} onClick={() => editCard(card)}>
                        <div><strong>{card.title}</strong><small>{card.type} · {card.currentState ? card.currentState.slice(0, 80) : '状态未更新'}</small></div>
                        <button className="chapter-location-button" title="打开卡片文件所在位置" aria-label={`打开${card.title}文件所在位置`} onClick={(event) => { event.stopPropagation(); handleOpenCardLocation(card); }}>打开位置</button>
                        <button className="link-button" title="全文检索并更新卡片状态" onClick={(event) => { event.stopPropagation(); editCard(card); void updateCardStatesFromBook(card.id); }}>更新状态</button>
                        <button className="icon-delete" title="删除卡片" onClick={(event) => { event.stopPropagation(); deleteCard(card.id); }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div className="card-editor">
                    <select className="select" value={cardDraft.type} onChange={(event) => setCardDraft({ ...cardDraft, type: event.target.value as CardType })}>
                      <option value="角色卡">角色卡</option><option value="物品卡">物品卡</option><option value="地点卡">地点卡</option><option value="势力卡">势力卡</option><option value="金手指卡">金手指卡</option>
                    </select>
                    <input className="input" placeholder="卡片名称" value={cardDraft.title} onChange={(event) => setCardDraft({ ...cardDraft, title: event.target.value })} />
                    <textarea className="card-content-editor" placeholder="详细信息、性格、能力、关系、限制等" value={cardDraft.content} onChange={(event) => setCardDraft({ ...cardDraft, content: event.target.value })} />
                    {activeCard?.currentState && <p className="card-state-preview"><strong>当前状态：</strong>{activeCard.currentState}</p>}
                    <div className="card-editor-actions">
                      <button className="btn-secondary" disabled={cardGenerating} onClick={generateCardWithAI}>{cardGenerating ? '生成中...' : 'AI 生成卡片'}</button>
                      {activeCard && <button className="btn-secondary" onClick={() => updateCardStatesFromBook(activeCard.id)}>更新状态</button>}
                      <button className="btn-primary" disabled={cardGenerating} onClick={saveCard}>{activeCard ? '保存卡片' : '创建卡片'}</button>
                    </div>
                  </div>
                </div>
              )}

              {editorSidebarTab === 'knowledge' && (
                <div className="knowledge-panel">
                  <div className="knowledge-toolbar">
                    <button className="knowledge-rebuild-button" onClick={rebuildMemoryDocuments}>重新整理记忆</button>
                  </div>
                  <div className="memory-kind-list">
                    {memoryDocumentKinds.map(kind => {
                      const document = editingProject.memoryDocuments.find(item => item.kind === kind);
                      return <button
                        key={kind}
                        className={`memory-kind-button ${activeMemoryDocumentId === document?.id ? 'active' : ''}`}
                        onClick={() => setActiveMemoryDocumentId(document?.id ?? memoryDocumentId(kind))}
                      >{kind}{kind === '章节快照' && <small>{editingProject.memories.length}</small>}</button>;
                    })}
                  </div>

                  {activeMemoryDocumentId === memoryDocumentId('章节快照') && (
                    <section className="snapshot-section">
                      <div className="panel-section-title">章节记忆 <span>{editingProject.memories.length} 章</span></div>
                      {editingProject.memories.length === 0 ? <p className="empty-hint">保存有正文的章节后，会在这里形成逐章记忆快照。</p> : [...editingProject.memories].sort((left, right) => chapterOrder(left) - chapterOrder(right)).map(memory => (
                        <button
                          type="button"
                          className={`memory-item memory-item-button ${activeChapterMemoryId === memory.id ? 'active' : ''}`}
                          key={memory.id}
                          onClick={() => setActiveChapterMemoryId(memory.id)}
                        >
                          <strong>{memory.sourceChapterNumber ? `第 ${memory.sourceChapterNumber} 章` : memory.chapterTitle}</strong>
                          <span className="memory-item-title">{memory.chapterTitle}</span>
                          <p>{memory.summary || '暂无摘要'}</p>
                          <small>{memory.keywords.join(' · ') || '暂无关键词'}</small>
                          <div className="memory-details">
                            <span>{memory.characterStateChanges.length} 条人物变化 · {memory.foreshadowingChanges.length} 条伏笔 · {memory.timelineEvents.length} 条时间线</span>
                            {memory.endingHook && <span>章末钩子：{memory.endingHook}</span>}
                          </div>
                        </button>
                      ))}
                    </section>
                  )}

                </div>
              )}
              <div className="editor-sidebar-footer">
                <button className="settings-button" onClick={openSettings}>⚙ 设置</button>
              </div>
            </aside>

            <main className="editor-main">
              {editorSidebarTab === 'knowledge-graph' ? (
                <section className="knowledge-graph-workspace">
                  <div className="knowledge-graph-header"><div><span>关系视图</span><h3>知识图谱</h3></div><small>{editingProject.graphNodes.length} 个节点 · {editingProject.graphEdges.length} 条关系</small></div>
                  {editingProject.graphNodes.length === 0 ? <div className="empty-state"><p>保存章节并勾选知识卡后，这里会显示章节、设定和卡片的引用关系。</p></div> : <>
                    <div className="knowledge-graph-canvas">
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{editingProject.graphEdges.map(edge => {
                        const source = graphLayout.find(item => item.id === edge.source);
                        const target = graphLayout.find(item => item.id === edge.target);
                        return source && target ? <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null;
                      })}</svg>
                      {editingProject.graphNodes.map(node => {
                        const position = graphLayout.find(item => item.id === node.id) ?? { x: 50, y: 50 };
                        return <button key={node.id} className={`knowledge-graph-vertex ${node.type} ${activeGraphNodeId === node.id ? 'active' : ''}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} onClick={() => setActiveGraphNodeId(node.id)}>{node.label}</button>;
                      })}
                    </div>
                    <div className="knowledge-graph-details">
                      <div><strong>{activeGraphNode?.label || '选择一个节点'}</strong><span>{activeGraphNode ? ({ chapter: '章节', card: '知识卡', outline: '大纲', entity: activeGraphNode.category || '实体' }[activeGraphNode.type]) : '查看节点关联'}</span></div>
                      <div className="knowledge-graph-relations">{!activeGraphNode ? '点击图中的节点查看关联。' : editingProject.graphEdges.filter(edge => edge.source === activeGraphNode.id || edge.target === activeGraphNode.id).map(edge => {
                        const otherId = edge.source === activeGraphNode.id ? edge.target : edge.source;
                        const other = editingProject.graphNodes.find(node => node.id === otherId);
                        return <button key={edge.id} onClick={() => setActiveGraphNodeId(otherId)}>{edge.source === activeGraphNode.id ? '关联到' : '被引用于'} {other?.label || otherId}<small>{edge.label}</small></button>;
                      })}</div>
                    </div>
                  </>}
                </section>
              ) : editorSidebarTab === 'knowledge' && activeMemoryDocumentId === memoryDocumentId('章节快照') && activeChapterMemory ? (
                <section className="memory-snapshot-editor">
                  <div className="memory-document-header">
                    <div><span>逐章记忆快照</span><h3>{activeChapterMemory.chapterTitle}</h3></div>
                    <button className="btn-primary" onClick={saveActiveChapterMemory}>保存本章记忆</button>
                  </div>
                  <div className="memory-snapshot-form">
                    <label>章节摘要<textarea value={activeChapterMemory.summary} onChange={(event) => updateChapterMemory({ summary: event.target.value })} /></label>
                    <label>关键词 <small>每行一个，也可用顿号分隔</small><textarea value={activeChapterMemory.keywords.join('\n')} onChange={(event) => updateChapterMemory({ keywords: memoryTextList(event.target.value).slice(0, 8) })} /></label>
                    <div className="memory-snapshot-grid">
                      <label>人物状态变化<textarea value={activeChapterMemory.characterStateChanges.join('\n')} onChange={(event) => updateChapterMemory({ characterStateChanges: memoryTextList(event.target.value) })} /></label>
                      <label>角色认知变化<textarea value={activeChapterMemory.knowledgeChanges.join('\n')} onChange={(event) => updateChapterMemory({ knowledgeChanges: memoryTextList(event.target.value) })} /></label>
                      <label>伏笔追踪<textarea value={activeChapterMemory.foreshadowingChanges.join('\n')} onChange={(event) => updateChapterMemory({ foreshadowingChanges: memoryTextList(event.target.value) })} /></label>
                      <label>时间线事件<textarea value={activeChapterMemory.timelineEvents.join('\n')} onChange={(event) => updateChapterMemory({ timelineEvents: memoryTextList(event.target.value) })} /></label>
                      <label>设定事实<textarea value={activeChapterMemory.canonFacts.join('\n')} onChange={(event) => updateChapterMemory({ canonFacts: memoryTextList(event.target.value) })} /></label>
                      <label>冲突<textarea value={activeChapterMemory.conflicts.join('\n')} onChange={(event) => updateChapterMemory({ conflicts: memoryTextList(event.target.value) })} /></label>
                    </div>
                    <label>章末钩子<textarea value={activeChapterMemory.endingHook} onChange={(event) => updateChapterMemory({ endingHook: event.target.value })} /></label>
                  </div>
                  <p className="memory-document-meta">本章快照与聚合记忆会同步写入小说目录的“记忆”文件夹，并可被章节智能体按勾选项检索。</p>
                </section>
              ) : editorSidebarTab === 'knowledge' && activeMemoryDocument ? (
                <section className="memory-document-editor">
                  <div className="memory-document-header">
                    <div><span>本地记忆文档</span><h3>{activeMemoryDocument.title}</h3></div>
                    <button className="btn-primary" onClick={saveActiveMemoryDocument}>保存记忆</button>
                  </div>
                  <textarea
                    className="memory-document-content"
                    value={activeMemoryDocument.content}
                    onChange={(event) => updateMemoryDocument(activeMemoryDocument.id, event.target.value)}
                    placeholder="在此编辑记忆 Markdown..."
                  />
                  <p className="memory-document-meta">保存后写入小说目录的“{'记忆/'}{activeMemoryDocument.title}.md”，章节智能体会把该类记忆加入上下文检索。</p>
                </section>
              ) : activeChapter ? (
                <>
                  <div className="chapter-editor-toolbar">
                    <div className="chapter-toolbar-search">
                      <button className={`editor-tool-button ${showSearchPanel ? 'active' : ''}`} onClick={() => { setShowSearchPanel(current => !current); window.setTimeout(() => searchInputRef.current?.focus(), 0); }}>搜索 / 替换</button>
                      <span className="search-shortcut">⌘/Ctrl F</span>
                    </div>
                    <span className="chapter-goal-status">目标 {Number(editingProject.chapterTargetWords) || 3000} 字 · 上限 {Math.floor((Number(editingProject.chapterTargetWords) || 3000) * 1.2)} 字</span>
                  </div>
                  {showSearchPanel && (
                    <section className="search-panel" aria-label="搜索与替换">
                      <div className="search-panel-row">
                        <input ref={searchInputRef} className="input" value={searchQuery} placeholder="搜索本章或全文" onChange={event => { setSearchQuery(event.target.value); setSearchMatchIndex(0); }} />
                        <select className="select" value={searchScope} onChange={event => setSearchScope(event.target.value as 'chapter' | 'book')}><option value="chapter">本章</option><option value="book">全文</option></select>
                        {searchScope === 'chapter' && <><button className="editor-tool-button" onClick={() => focusSearchMatch(-1)} disabled={!searchQuery}>上一个</button><button className="editor-tool-button" onClick={() => focusSearchMatch(1)} disabled={!searchQuery}>下一个</button></>}
                        <button className="icon-delete" title="关闭搜索" onClick={() => setShowSearchPanel(false)}>×</button>
                      </div>
                      {searchScope === 'chapter' ? <div className="search-panel-row replace-row"><input className="input" value={replaceQuery} placeholder="替换为" onChange={event => setReplaceQuery(event.target.value)} /><button className="editor-tool-button" onClick={replaceCurrentMatch} disabled={!searchQuery}>替换</button><button className="editor-tool-button" onClick={replaceAllMatches} disabled={!searchQuery}>全部替换</button><small>{currentSearchMatches ? `${Math.min(searchMatchIndex + 1, currentSearchMatches)} / ${currentSearchMatches}` : '无匹配'}</small></div> : <div className="book-search-results">{!searchQuery.trim() ? <span>输入关键词搜索整本小说</span> : bookSearchResults.length ? bookSearchResults.map(({ chapter, count }) => <button key={chapter.id} onClick={() => { setActiveChapter(chapter); setSearchScope('chapter'); setSearchMatchIndex(0); }}>{chapter.title}<small>{count} 处匹配 · {chapter.wordCount} 字</small></button>) : <span>没有找到匹配章节</span>}</div>}
                    </section>
                  )}
                  <input
                    type="text"
                    className="chapter-title-input"
                    value={activeChapter.title}
                    onChange={(e) => {
                      const updatedChapter = { ...activeChapter, title: e.target.value, updatedAt: new Date().toISOString() };
                      const updatedChapters = editingProject.chapters.map(c => c.id === activeChapter.id ? updatedChapter : c);
                      const updated = { ...editingProject, chapters: updatedChapters, updatedAt: new Date().toISOString() };
                      setEditingProject(updated);
                      setActiveChapter(updatedChapter);
                      setProjects(current => current.map(p => p.id === updated.id ? updated : p));
                    }}
                  />
                  <div className="chapter-editor-wrap">
                    <div ref={highlightLayerRef} className="chapter-highlight-layer" aria-hidden="true">{renderMarkedContent(activeChapter.content)}</div>
                    <textarea
                      ref={chapterEditorRef}
                      className="chapter-content-editor"
                      value={activeChapter.content}
                      onChange={(e) => handleUpdateChapterContent(e.target.value)}
                      onSelect={captureChapterSelection}
                      onScroll={(event) => { if (highlightLayerRef.current) highlightLayerRef.current.scrollTop = event.currentTarget.scrollTop; }}
                      placeholder="开始写作..."
                      spellCheck={false}
                    />
                  </div>
                  <div className="chapter-live-footer">
                    <span>本章实时字数 <strong>{activeChapter.wordCount.toLocaleString()}</strong></span>
                    <span>{currentSearchMatches ? `搜索到 ${currentSearchMatches} 处` : writingMarksEnabled ? `人物 ${characterNames.length} 个 · 禁词 ${bannedWords.length} 个` : '标记已关闭'}</span>
                    {activeChapter.wordCount >= (Number(editingProject.chapterTargetWords) || 3000) && <button className="link-button" onClick={handleAddChapter}>创建下一章</button>}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>从左侧选择或新建章节开始写作</p>
                </div>
              )}
            </main>

            <aside className="agent-panel">
              <div className="agent-panel-header">
                <span>AI 智能体</span>
                <select
                  className="agent-model-select"
                  value={agentConfig.model}
                  onChange={(event) => setAgentConfig(current => ({ ...current, model: event.target.value }))}
                  aria-label="选择写作模型"
                >
                  {Array.from(new Set([agentConfig.model, ...availableModels])).filter(Boolean).map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </div>

              <div className="agent-panel-scroll">
                <section className="agent-task-section">
                  <label>创作指令</label>
                  <textarea value={agentInstruction} onChange={(event) => setAgentInstruction(event.target.value)} />
                  <div className="ai-writing-tools">
                    <div className="agent-card-picker-title">润色 / 续写要求 <small>可选</small></div>
                    <textarea value={aiToolInstruction} onChange={event => setAIToolInstruction(event.target.value)} placeholder="例如：加强紧张感，保留冷峻文风；或让主角先观察再行动" />
                    <div className="ai-writing-tool-actions">
                      <button className="btn-secondary" disabled={aiToolRunning || !activeChapter} onClick={() => runAITool('polish')}>{aiToolRunning && aiToolMode === 'polish' ? '润色中...' : '润色选中内容 / 整章'}</button>
                      <button className="btn-primary" disabled={aiToolRunning || !activeChapter} onClick={() => runAITool('continue')}>{aiToolRunning && aiToolMode === 'continue' ? '续写中...' : '生成续写'}</button>
                    </div>
                    {aiToolResult && <div className="ai-tool-result">
                      <div><strong>{aiToolResult.mode === 'continue' ? '续写草稿' : '润色草稿'}</strong><span>{countNovelCharacters(aiToolResult.content)} 字{aiToolResult.maxWords ? ` / 最多 ${aiToolResult.maxWords} 字` : ''}</span></div>
                      <textarea value={aiToolResult.content} onChange={event => setAIToolResult(current => current ? { ...current, content: event.target.value } : current)} />
                      <div className="ai-writing-tool-actions"><button className="btn-secondary" onClick={() => copyText(aiToolResult.content)}>复制</button><button className="btn-primary" onClick={acceptAIToolResult}>{aiToolResult.mode === 'continue' ? '确认插入章节' : '确认替换'}</button></div>
                    </div>}
                  </div>
                  <div className="agent-card-picker">
                    <div className="agent-card-picker-title">本章带入卡片 <small>{selectedCardIds.length} 张</small></div>
                    {editingProject.cards.length === 0 ? <p className="empty-hint compact">先在卡片页创建知识卡</p> : editingProject.cards.map(card => (
                      <label key={card.id} className="agent-card-option">
                        <input type="checkbox" checked={selectedCardIds.includes(card.id)} onChange={() => toggleCardForChapter(card.id)} />
                        <span><strong>{card.title}</strong><small>{card.type}</small></span>
                      </label>
                    ))}
                  </div>
                  <div className="agent-memory-picker">
                    <div className="agent-card-picker-title">本章带入记忆 <small>{selectedMemoryIds.length} 章</small></div>
                    {editingProject.memories.length === 0 ? <p className="empty-hint compact">保存章节后会出现逐章记忆，可按需勾选。</p> : [...editingProject.memories].sort((left, right) => chapterOrder(right) - chapterOrder(left)).map(memory => (
                      <label key={memory.id} className="agent-memory-option">
                        <input type="checkbox" checked={selectedMemoryIds.includes(memory.id)} onChange={() => setSelectedMemoryIds(current => current.includes(memory.id) ? current.filter(id => id !== memory.id) : [...current, memory.id])} />
                        <span><strong>{memory.sourceChapterNumber ? `第 ${memory.sourceChapterNumber} 章` : memory.chapterTitle}</strong><small>{memory.chapterTitle} · {memory.keywords.slice(0, 3).join('、') || '暂无关键词'}</small></span>
                      </label>
                    ))}
                  </div>
                  <button className={`agent-run-button ${agentRunning(agentStage) ? 'running' : ''}`} aria-busy={agentRunning(agentStage)} onClick={runChapterAgent}>
                    {agentRunning(agentStage) ? `智能体执行中 · ${agentProgressPercent}%` : '运行章节智能体'}
                  </button>
                </section>

                {agentProgress.length > 0 && (
                  <section className={`agent-progress-panel ${agentStage === 'error' ? 'error' : agentStage === 'done' ? 'done' : ''}`} aria-live="polite">
                    <div className="agent-progress-heading">
                      <div><strong>智能体执行过程</strong><small>{agentProgressMessage || agentStageLabel[agentStage]}</small></div>
                      <span>{agentProgressPercent}%</span>
                    </div>
                    <div className="agent-progress-bar" aria-label={`智能体进度 ${agentProgressPercent}%`}><i style={{ width: `${agentProgressPercent}%` }} /></div>
                    <ol className="agent-progress-steps">
                      {agentProgress.map(item => (
                        <li key={item.id} className={item.status}>
                          <span className="agent-progress-dot" aria-hidden="true" />
                          <div><strong>{item.label}</strong><small>{item.message || item.description}</small></div>
                          <b>{item.status === 'complete' ? '完成' : item.status === 'active' ? '进行中' : item.status === 'error' ? '失败' : '等待'}</b>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {agentError && <div className="agent-error">{agentError}</div>}

                {agentDraft?.draftContent && (
                  <section className="agent-result-section">
                    <div className="agent-result-title"><strong>章节草稿</strong><span>{countNovelCharacters(agentDraft.draftContent)} 字</span></div>
                    {(agentDraft.recognizedIntent || agentDraft.selectedSkills?.length) && <div className="agent-intent-result"><span>识别意图：{agentDraft.recognizedIntent || '章节创作与续写'}</span>{agentDraft.selectedSkills?.map(skill => <b key={skill}>{skill}</b>)}</div>}
                    {agentDraft.contextReport && <div className="agent-context-report">
                      <span>{agentDraft.contextReport.cache === 'hit' ? '缓存命中' : '缓存未命中'}</span>
                      <span>发送上下文 {((agentDraft.contextReport.draftInputBytes || agentDraft.contextReport.packedBytes || 0) / 1024).toFixed(1)} KB</span>
                      {agentDraft.contextReport.prunedBytes ? <span>已裁剪 {(agentDraft.contextReport.prunedBytes / 1024).toFixed(1)} KB</span> : null}
                      {agentDraft.contextReport.estimatedInputTokens ? <span>估算输入 {agentDraft.contextReport.estimatedInputTokens.toLocaleString()} tokens</span> : null}
                    </div>}
                    <textarea className="agent-draft-preview" value={agentDraft.draftContent} onChange={(event) => setAgentDraft({ ...agentDraft, draftContent: event.target.value })} />
                    {agentDraft.summary && <p className="agent-summary">{agentDraft.summary}</p>}
                    {agentDraft.reviewResult && (
                      <div className={`agent-review ${agentDraft.reviewResult.consistent ? 'passed' : 'warning'}`}>
                        <strong>{agentDraft.reviewResult.consistent ? '一致性审查通过' : '发现一致性问题'}</strong>
                        {agentDraft.reviewResult.issues.map(issue => <p key={issue}>{issue}</p>)}
                        {agentDraft.reviewResult.suggestions.map(suggestion => <p key={suggestion}>建议：{suggestion}</p>)}
                      </div>
                    )}
                    <div className="agent-result-actions">
                      <button className="btn-secondary" onClick={() => setAgentDraft(null)}>放弃</button>
                      <button className="btn-primary" onClick={acceptAgentDraft}>接受并写入</button>
                    </div>
                  </section>
                )}
              </div>
            </aside>
          </div>
          {showNewSkillModal && (
            <div className="modal-overlay editor-modal-overlay" onClick={() => setShowNewSkillModal(false)}>
              <div className="modal" role="dialog" aria-modal="true" aria-labelledby="skill-modal-title" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header">
                  <h3 id="skill-modal-title">{skillEditingId === null ? '新建技能' : '编辑技能'}</h3>
                  <button className="modal-close" aria-label="关闭" onClick={() => setShowNewSkillModal(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div className="form-group"><label>技能名称 *</label><input type="text" className="input" placeholder="例如：场景切换" value={newSkill.name} onChange={(event) => setNewSkill({ ...newSkill, name: event.target.value })} /></div>
                  <div className="form-group">
                    <label>分类</label>
                    <select className="select" value={newSkill.category} onChange={(event) => setNewSkill({ ...newSkill, category: event.target.value })}>
                      <option value="setup">项目设置</option><option value="write">写作</option><option value="review">审查</option><option value="polish">润色</option><option value="import">导入</option><option value="analyze">分析</option><option value="tool">工具</option><option value="creator">创建器</option>
                    </select>
                  </div>
                  <div className="form-group"><label>简短描述</label><input type="text" className="input" placeholder="一句话描述这个技能" value={newSkill.description} onChange={(event) => setNewSkill({ ...newSkill, description: event.target.value })} /></div>
                  <div className="form-group"><label>详细内容 *</label><textarea className="textarea" rows={6} placeholder="详细说明如何使用这个技能..." value={newSkill.content} onChange={(event) => setNewSkill({ ...newSkill, content: event.target.value })} /></div>
                  <div className="form-group"><label>标签（逗号分隔）</label><input type="text" className="input" placeholder="场景,过渡,技巧" value={newSkill.tags} onChange={(event) => setNewSkill({ ...newSkill, tags: event.target.value })} /></div>
                  <div className="skill-creator-actions"><button className="btn-secondary" onClick={generateSkillWithAI} disabled={skillGenerating}>{skillGenerating ? '生成中...' : 'AI 生成技能草稿'}</button><span>可先填写一句需求，再由 skill-creator 补全步骤和输出格式。</span></div>
                </div>
                <div className="modal-footer"><button className="btn-secondary" onClick={() => setShowNewSkillModal(false)}>取消</button><button className="btn-primary" onClick={handleCreateSkill}>{skillEditingId === null ? '创建' : '保存修改'}</button></div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
      <aside className="sidebar">
        <div className="logo">
          <h1>ApiSaverWriter</h1>
          <p>AI 小说写作助手</p>
        </div>

        <nav className="nav">
          <button
            className={activeTab === 'projects' ? 'active' : ''}
            onClick={() => setActiveTab('projects')}
          >
            📚 小说管理
          </button>
        </nav>
      </aside>

      <main className="main">
        {activeTab === 'projects' && (
          <div className="projects">
            {projects.length === 0 ? (
              <div className="empty-project-home">
                <div className="empty-project-mark">文</div>
                <span className="empty-project-eyebrow">AI 小说写作空间</span>
                <h2>开始你的第一部小说</h2>
                <p>创建一个本地写作项目，章节、大纲、卡片和记忆都会保存在你的设备上。</p>
                <button className="btn-primary empty-project-cta" onClick={openNewProjectModal}>+ 新建小说</button>
              </div>
            ) : (
              <>
                <header className="page-header">
                  <h2>小说管理</h2>
                  <button className="btn-primary" onClick={openNewProjectModal}>+ 新建小说</button>
                </header>
                <div className="project-grid">
                  {projects.map((project) => (
                    <div key={project.id} className="project-card">
                      <h3>{project.title}</h3>
                      <div className="project-meta">
                        <span className="genre">{project.subgenre ?? project.genre}</span>
                        {project.tags?.主题?.slice(0, 2).map(tag => <span key={tag} className="genre">{tag}</span>)}
                        <span className="status">{project.status === 'completed' ? '已完结' : '连载中'}</span>
                      </div>
                      <div className="project-stats">
                        <span>{project.wordCount.toLocaleString()} 字</span>
                        <span>更新于 {new Date(project.updatedAt).toLocaleDateString()}</span>
                      </div>
                      <div className="project-actions">
                        <button className="btn-secondary" onClick={() => handleEditProject(project.id)}>进入</button>
                        <button className="btn-secondary" onClick={() => openProjectEdit(project)}>编辑</button>
                        <button className="btn-secondary" onClick={() => handleOpenProjectLocation(project)}>打开位置</button>
                        <button className="btn-danger" onClick={() => setProjectPendingDeletion(project)}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

      </main>

      {!editingProject && notice && (
        <div className="app-notice" role="status" aria-live="polite">
          <div className="app-notice-copy">
            <strong>{notice.title}</strong>
            <span>{notice.content}</span>
          </div>
          <button className="app-notice-close" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
      </>
      )}

      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 id="settings-title">设置</h3>
              <button className="modal-close" aria-label="关闭" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <section className="settings-service-card">
                <div className="settings-service-header">
                  <button className="settings-collapse-button" aria-label={settingsServiceExpanded ? '收起服务配置' : '展开服务配置'} onClick={() => setSettingsServiceExpanded(current => !current)}>{settingsServiceExpanded ? '⌄' : '›'}</button>
                  <div className="settings-service-title">
                    <strong>AI 模型配置</strong>
                    <span>服务、接口、密钥与模型参数</span>
                  </div>
                  <label className="settings-toggle" title="启用此服务">
                    <input type="checkbox" checked={settingsDraft.enabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, enabled: event.target.checked })} />
                    <span />
                  </label>
                </div>
                {settingsServiceExpanded && <div className="settings-service-content">
                  <div className="form-group">
                    <label>服务名称</label>
                    <input className="input" value={settingsDraft.serviceName} onChange={(event) => setSettingsDraft({ ...settingsDraft, serviceName: event.target.value })} placeholder="服务名称" />
                  </div>
                  <div className="form-group">
                    <label>API 模式</label>
                    <div className="settings-segmented-control">
                      {([['openai', 'OpenAI 兼容'], ['responses', 'Responses API'], ['anthropic', 'Anthropic 兼容']] as Array<[ApiMode, string]>).map(([mode, label]) => <button key={mode} className={settingsDraft.apiMode === mode ? 'active' : ''} onClick={() => setSettingsDraft({ ...settingsDraft, apiMode: mode })}>{label}</button>)}
                    </div>
                  </div>
                  <div className="form-group">
                    <label>接口地址</label>
                    <input className="input" value={settingsDraft.baseURL} placeholder={defaultBaseURL} onChange={(event) => setSettingsDraft({ ...settingsDraft, baseURL: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>API 密钥 <small>{(settingsDraft.apiKeys || []).filter(Boolean).length} 个</small></label>
                    <input className="input" type="password" value={settingsDraft.apiKey} placeholder="请输入主 API Key" onChange={(event) => updatePrimaryApiKey(event.target.value)} />
                    {(settingsDraft.apiKeys || []).length > 1 && <div className="settings-key-tags">{settingsDraft.apiKeys.map((key, index) => <span key={`${key}-${index}`} className={index === 0 ? 'active' : ''}>Key {index + 1} · {key.slice(0, 4)}••••{key.slice(-4)}<button aria-label={`移除 Key ${index + 1}`} onClick={() => removeApiKey(index)}>×</button></span>)}</div>}
                    <div className="model-add-row"><input className="input" type="password" value={customApiKey} placeholder="添加备用供应商 Key" onChange={(event) => setCustomApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addApiKey(); } }} /><button className="btn-secondary" onClick={addApiKey}>添加 Key</button></div>
                  </div>
                  <div className="form-group model-management">
                    <label>模型标签 <small>当前模型：{settingsDraft.model || '未选择'}</small></label>
                    <div className="settings-model-tags">
                      {settingsModels.map(model => <button key={model} className={`settings-model-tag ${settingsDraft.model === model ? 'active' : ''}`} onClick={() => setSettingsDraft({ ...settingsDraft, model })} title="点击设为当前模型"><span>{model}</span><b aria-label={`移除 ${model}`} onClick={(event) => { event.stopPropagation(); toggleSettingsModel(model); }}>×</b></button>)}
                      {!settingsModels.length && <span className="settings-model-empty">暂无启用模型</span>}
                    </div>
                    <div className="model-add-row">
                      <input className="input" value={customModelName} placeholder="输入模型 ID，回车添加" onChange={(event) => setCustomModelName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomModel(); } }} />
                      <button className="btn-secondary" onClick={addCustomModel}>添加</button>
                    </div>
                    {fetchedModels.length > 0 && <div className="settings-fetched-models"><span>接口返回模型</span><div>{fetchedModels.map(model => <button key={model} className={settingsModels.includes(model) ? 'added' : ''} disabled={settingsModels.includes(model)} onClick={() => addSettingsModel(model)}>{settingsModels.includes(model) ? '✓ ' : '+ '}{model}</button>)}</div></div>}
                    <div className="settings-model-actions">
                      <button className="btn-secondary" onClick={pullModels} disabled={modelsLoading}>{modelsLoading ? '拉取中...' : '拉取模型'}</button>
                      <button className="btn-secondary" onClick={testSelectedModel} disabled={modelsTesting || !settingsDraft.model.trim()}>{modelsTesting ? '测试中...' : '测试模型'}</button>
                    </div>
                    {modelListMessage && <p className={`model-list-message ${modelListMessage.includes('失败') || modelListMessage.includes('错误') ? 'error' : ''}`}>{modelListMessage}</p>}
                  </div>
                  <div className="settings-grid-two">
                    <div className="form-group"><label>上下文窗口 <strong>{Number(settingsDraft.contextWindow).toLocaleString()} KB</strong></label><input className="settings-range" type="range" min="16" max="512" step="16" value={settingsDraft.contextWindow} onChange={(event) => setSettingsDraft({ ...settingsDraft, contextWindow: Number(event.target.value) })} /></div>
                    <div className="form-group"><label>推理模式</label><select className="select" value={settingsDraft.reasoningMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, reasoningMode: event.target.value as ReasoningMode })}><option value="auto">自动</option><option value="off">关闭</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="max">最大</option><option value="custom">自定义</option></select></div>
                  </div>
                </div>}
              </section>
              <section className="settings-network-card settings-network-panel">
                <div className="settings-network-header"><div><strong>网络设置</strong><small>为模型请求配置代理连接</small></div><label className="settings-toggle" title="启用网络代理"><input type="checkbox" checked={settingsDraft.proxyEnabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, proxyEnabled: event.target.checked })} /><span /></label></div>
                <div className="settings-network-address"><input className="input" value={settingsDraft.proxyURL} disabled={!settingsDraft.proxyEnabled} placeholder="http://127.0.0.1:7897" onChange={(event) => setSettingsDraft({ ...settingsDraft, proxyURL: event.target.value })} /><button className="btn-secondary" onClick={useSystemProxy}>读取系统代理</button></div>
                <label className="settings-network-check"><input type="checkbox" checked={settingsDraft.proxyBypassLocal} onChange={(event) => setSettingsDraft({ ...settingsDraft, proxyBypassLocal: event.target.checked })} /> 本地地址不走代理（推荐）</label>
                <small className="settings-network-note">支持 HTTP/HTTPS 代理，例如 Clash、Surge、V2Ray 的本地 HTTP 端口；SOCKS 地址请先转换为 HTTP 端口。</small>
              </section>
              <p className="settings-hint">保存后，编辑器中的 AI 智能体会使用模型与网络配置。密钥仅保存到本机。</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettingsModal(false)}>取消</button>
              <button className="btn-primary" onClick={saveSettings}>保存设置</button>
            </div>
          </div>
        </div>
      )}

      {showOutlineTypeModal && editingProject && (
        <div className="modal-overlay" onClick={() => setShowOutlineTypeModal(false)}>
          <div className="modal outline-type-modal" role="dialog" aria-modal="true" aria-labelledby="outline-type-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 id="outline-type-title">新建大纲</h3>
              <button className="modal-close" aria-label="关闭" onClick={() => setShowOutlineTypeModal(false)}>×</button>
            </div>
            <div className="modal-body outline-type-options">
              <p>请选择要创建的大纲类型</p>
              {outlineKinds.map(kind => <button key={kind} className="outline-type-option" onClick={() => chooseOutlineType(kind)}><strong>{kind}</strong><span>创建 Markdown 文档</span></button>)}
            </div>
          </div>
        </div>
      )}

      {/* 新建小说模态框 */}
      {showNewProjectModal && (
        <div className="modal-overlay" onClick={() => setShowNewProjectModal(false)}>
          <div className="modal new-project-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{projectFormMode === 'edit' ? '编辑小说' : '新建小说'}</h3>
              <button className="modal-close" aria-label="关闭" onClick={() => setShowNewProjectModal(false)}>×</button>
            </div>
            <div className="modal-body create-project-body">
              <aside className="cover-column">
                <div className={`cover-preview ${newProject.cover ? 'has-image' : ''}`}>
                  {newProject.cover ? (
                    <img src={newProject.cover} alt="小说封面预览" />
                  ) : (
                    <>
                      <span className="cover-book-name">{newProject.title || '书本名称'}</span>
                      <span className="cover-decoration">文</span>
                      <small>ApiSaverWriter</small>
                    </>
                  )}
                </div>
                <label className="cover-upload-button">
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleCoverChange} />
                  选择封面
                </label>
                <p>支持 JPG、PNG、WebP，自动压缩保存</p>
              </aside>

              <div className="create-project-form">
                <div className="create-form-row">
                  <label htmlFor="project-title"><span className="required-mark">*</span>书本名称</label>
                  <div className="project-field-stack">
                    <div className="counted-field">
                      <input
                        id="project-title"
                        type="text"
                        className="input"
                        placeholder="请输入作品名称"
                        maxLength={15}
                        value={newProject.title}
                        onChange={(e) => setNewProject({ ...newProject, title: e.target.value })}
                      />
                      <span>{newProject.title.length}/15</span>
                    </div>
                    <div className="project-ai-actions">
                      <span>AI 参考</span>
                      <select className="select" value={projectGenerationSource} onChange={(event) => setProjectGenerationSource(event.target.value as 'outline' | 'chapters')}>
                        <option value="outline">作品大纲</option>
                        <option value="chapters">前 3 章内容</option>
                      </select>
                      <button className="btn-secondary" type="button" disabled={projectGeneratingField !== null} onClick={() => generateProjectField('title')}>{projectGeneratingField === 'title' ? '生成中...' : 'AI 生成书名'}</button>
                    </div>
                  </div>
                </div>

                <div className="create-form-row">
                  <label>目标读者</label>
                  <div className="channel-switcher" role="radiogroup" aria-label="目标读者">
                    {(['男频', '女频'] as Channel[]).map(channel => (
                      <button
                        key={channel}
                        type="button"
                        role="radio"
                        aria-checked={newProject.channel === channel}
                        className={newProject.channel === channel ? 'active' : ''}
                        onClick={() => handleChannelChange(channel)}
                      >
                        <span className="radio-dot" />{channel}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="create-form-row">
                  <label>作品标签</label>
                  <div className="tag-field-wrap">
                    <button type="button" className="tag-picker-trigger" onClick={openProjectTagPicker}>
                      <span>{newProject.selectedTags.主分类.length ? '修改作品标签' : '请选择作品标签'}</span><span>›</span>
                    </button>
                    <div className="selected-tag-summary">
                      {Object.entries(newProject.selectedTags).flatMap(([tab, tags]) => tags.map(tag => <span key={`${tab}-${tag}`}>{tag}</span>))}
                    </div>
                  </div>
                </div>

                <div className="create-form-row">
                  <label>主角名</label>
                  <div className="protagonist-fields">
                    <div className="counted-field">
                      <input type="text" className="input" placeholder="请输入主角名1" maxLength={5} value={newProject.protagonist1} onChange={(e) => setNewProject({ ...newProject, protagonist1: e.target.value })} />
                      <span>{newProject.protagonist1.length}/5</span>
                    </div>
                    <div className="counted-field">
                      <input type="text" className="input" placeholder="请输入主角名2" maxLength={5} value={newProject.protagonist2} onChange={(e) => setNewProject({ ...newProject, protagonist2: e.target.value })} />
                      <span>{newProject.protagonist2.length}/5</span>
                    </div>
                  </div>
                </div>

                <div className="create-form-row synopsis-row">
                  <label htmlFor="project-synopsis">作品简介</label>
                  <div className="project-field-stack">
                    <div className="counted-field counted-textarea">
                      <textarea id="project-synopsis" className="textarea" placeholder="请输入作品简介" maxLength={500} value={newProject.synopsis} onChange={(e) => setNewProject({ ...newProject, synopsis: e.target.value })} />
                      <span>{newProject.synopsis.length}/500</span>
                    </div>
                    <div className="project-ai-actions synopsis-ai-actions">
                      <small>生成番茄风格的卖点简介，可根据当前选择的参考内容直接回填。</small>
                      <button className="btn-secondary" type="button" disabled={projectGeneratingField !== null} onClick={() => generateProjectField('synopsis')}>{projectGeneratingField === 'synopsis' ? '生成中...' : 'AI 生成作品简介'}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowNewProjectModal(false)}>
                取消
              </button>
              <button className="btn-primary" onClick={handleCreateProject}>
                {projectFormMode === 'edit' ? '保存修改' : '立即创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTagPicker && (
        <div className="modal-overlay tag-picker-overlay" onClick={() => setShowTagPicker(false)}>
          <div className="modal work-tags-modal" role="dialog" aria-modal="true" aria-labelledby="work-tags-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 id="work-tags-title">作品标签</h3>
              <button className="modal-close" aria-label="关闭" onClick={() => setShowTagPicker(false)}>×</button>
            </div>
            <div className="work-tags-body">
              <nav className="tag-tabs work-tag-tabs">
                {(Object.keys(channelTagCatalog[newProject.channel]) as TagTab[]).map(tab => (
                  <button key={tab} className={activeTagTab === tab ? 'active' : ''} onClick={() => setActiveTagTab(tab)}>
                    {tab === '主分类' && <span className="required-mark">*</span>}{tab}
                    {tagDraft[tab].length > 0 && <span className="tag-tab-count">{tagDraft[tab].length}</span>}
                  </button>
                ))}
              </nav>
              <div className="tag-grid work-tag-grid">
                {channelTagCatalog[newProject.channel][activeTagTab].map(tag => {
                  const selected = tagDraft[activeTagTab].includes(tag.name);
                  return (
                    <button key={tag.name} className={`tag-option ${selected ? 'selected' : ''}`} onClick={() => handleProjectTagToggle(tag.name)}>
                      <span className={`tag-option-icon ${tag.tone}`}>{tag.icon}</span>
                      <span className="tag-option-copy"><strong>{tag.name}</strong>{tag.description && <small>{tag.description}</small>}</span>
                      <span className="tag-check">{selected ? '✓' : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="work-tags-footer">
              <p>主分类必选且只能选一个，主题、角色、情节最多可选两个</p>
              <div><button className="btn-secondary" onClick={() => setShowTagPicker(false)}>取消</button><button className="btn-primary" onClick={confirmProjectTags}>确认</button></div>
            </div>
          </div>
        </div>
      )}

      {projectPendingDeletion && (
        <div className="modal-overlay" onClick={() => setProjectPendingDeletion(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-project-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 id="delete-project-title">删除小说</h3>
              <button className="modal-close" aria-label="关闭" onClick={() => setProjectPendingDeletion(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>确定删除《{projectPendingDeletion.title}》吗？</p>
              <p className="delete-warning">小说中的章节、大纲和本地保存内容都会被移除，此操作不可撤销。</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setProjectPendingDeletion(null)}>取消</button>
              <button className="btn-danger" onClick={handleDeleteProject}>确认删除</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
