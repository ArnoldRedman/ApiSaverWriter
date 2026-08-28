import assert from 'node:assert/strict';
import { test } from 'node:test';
import { removeChapterFromProject } from './chapter.ts';
import type { Project } from './project.ts';

const now = '2026-01-01T00:00:00.000Z';

const project = {
  id: 1,
  title: '城南夜雨',
  genre: '悬疑',
  status: 'writing',
  chapters: [
    { id: 10, title: '第一章', content: '入城。', wordCount: 3, createdAt: now, updatedAt: now },
    { id: 20, title: '第二章', content: '夜雨。', wordCount: 3, createdAt: now, updatedAt: now },
  ],
  outline: [],
  outlines: [
    { id: 100, kind: '章纲', chapterId: 20, title: '章纲｜第二章', content: '夜雨中的核对。', createdAt: now, updatedAt: now },
    { id: 101, kind: '总纲', title: '总纲', content: '全书主线。', createdAt: now, updatedAt: now },
  ],
  cards: [{
    id: 200, type: '角色卡', title: '林舟', content: '谨慎。', createdAt: now, updatedAt: now,
    stateHistory: [
      { chapterId: 10, chapterTitle: '第一章', status: '出现', changes: 'a', updatedAt: now },
      { chapterId: 20, chapterTitle: '第二章', status: '出现', changes: 'b', updatedAt: now },
    ],
  }],
  memories: [
    { id: 300, chapterId: 10, chapterTitle: '第一章', summary: 's1', keywords: [], characterStateChanges: [], knowledgeChanges: [], foreshadowingChanges: [], timelineEvents: [], canonFacts: [], conflicts: [], endingHook: '', createdAt: now, updatedAt: now },
    { id: 301, chapterId: 20, chapterTitle: '第二章', summary: 's2', keywords: [], characterStateChanges: [], knowledgeChanges: [], foreshadowingChanges: [], timelineEvents: [], canonFacts: [], conflicts: [], endingHook: '', createdAt: now, updatedAt: now },
  ],
  memoryDocuments: [],
  graphNodes: [
    { id: 'chapter:10', label: '第一章', type: 'chapter' },
    { id: 'chapter:20', label: '第二章', type: 'chapter' },
    { id: 'card:200', label: '林舟', type: 'card' },
  ],
  graphEdges: [
    { id: 'chapter:20->card:200:状态引用', source: 'chapter:20', target: 'card:200', label: '状态引用' },
    { id: 'chapter:10->card:200:状态引用', source: 'chapter:10', target: 'card:200', label: '状态引用' },
  ],
  aiDetection: {
    updatedAt: now, scope: 'book', averageAIRate: 40, level: '低', suggestion: '', provider: '本地启发式',
    chapters: [
      { chapterId: 10, chapterTitle: '第一章', wordCount: 3, sentenceUniformity: 0, logicFrequency: 0, colloquialFrequency: 0, psychologicalFrequency: 0, paragraphUniformity: 0, aiRate: 30, humanRate: 70, segments: [], label: '人工' },
      { chapterId: 20, chapterTitle: '第二章', wordCount: 3, sentenceUniformity: 0, logicFrequency: 0, colloquialFrequency: 0, psychologicalFrequency: 0, paragraphUniformity: 0, aiRate: 50, humanRate: 50, segments: [], label: '疑似 AI' },
    ],
  },
  createdAt: now,
  updatedAt: now,
  wordCount: 6,
} as unknown as Project;

test('删除章节会级联清理记忆、图谱、状态历史和检测报告', () => {
  const next = removeChapterFromProject(project, 20);

  assert.deepEqual(next.chapters.map(chapter => chapter.id), [10]);
  assert.equal(next.wordCount, 3);
  // 章纲是可复用的写作计划，保留但解除绑定
  assert.equal(next.outlines.length, 2);
  assert.equal(next.outlines.find(outline => outline.id === 100)?.chapterId, undefined);
  assert.deepEqual(next.memories.map(memory => memory.id), [300]);
  assert.deepEqual(next.cards[0].stateHistory?.map(entry => entry.chapterId), [10]);
  assert.deepEqual(next.graphNodes.map(node => node.id), ['chapter:10', 'card:200']);
  assert.deepEqual(next.graphEdges.map(edge => edge.id), ['chapter:10->card:200:状态引用']);
  assert.deepEqual(next.aiDetection?.chapters.map(item => item.chapterId), [10]);
});

test('删除不存在的章节时原样返回，不产生空写入', () => {
  assert.equal(removeChapterFromProject(project, 999), project);
});
