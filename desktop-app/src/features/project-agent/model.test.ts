import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProjectAgentChange } from './model.ts';
import type { Project } from '../../domain/project.ts';

const now = '2026-01-01T00:00:00.000Z';

const project = {
  id: 1,
  title: '城南夜雨',
  genre: '悬疑',
  status: 'writing',
  chapters: [
    { id: 10, title: '第 1 章', content: '## 第一章 入城\n\n林舟抵达城南。', wordCount: 12, createdAt: now, updatedAt: now },
    { id: 20, title: '第 2 章', content: '夜雨落在窗框上。', wordCount: 8, createdAt: now, updatedAt: now },
  ],
  outline: [],
  outlines: [],
  cards: [],
  memories: [],
  memoryDocuments: [],
  graphNodes: [],
  graphEdges: [],
  createdAt: now,
  updatedAt: now,
  wordCount: 20,
} as unknown as Project;

test('批量标题：保留真实章节，顺带带上 stripHeading 标记', () => {
  const change = normalizeProjectAgentChange({
    type: 'chapter.titles',
    summary: '批量补标题（2 章）',
    titles: [
      { targetId: 10, title: '第 1 章 入城', stripHeading: true },
      { targetId: 20, title: '第 2 章 夜雨敲窗' },
    ],
  }, project);

  assert.equal(change?.type, 'chapter.titles');
  assert.deepEqual(change?.type === 'chapter.titles' ? change.titles : [], [
    { targetId: 10, title: '第 1 章 入城', stripHeading: true },
    { targetId: 20, title: '第 2 章 夜雨敲窗', stripHeading: false },
  ]);
});

test('批量标题：已经不存在的章节和空标题被丢掉，其余照常保留', () => {
  const change = normalizeProjectAgentChange({
    type: 'chapter.titles',
    summary: '批量补标题',
    titles: [
      { targetId: 999, title: '不存在的章' },
      { targetId: 10, title: '   ' },
      { targetId: 20, title: '第 2 章 夜雨敲窗' },
    ],
  }, project);

  assert.deepEqual(change?.type === 'chapter.titles' ? change.titles.map(item => item.targetId) : [], [20]);
});

test('批量标题：一条都没剩下时整项丢弃，不生成空变更', () => {
  assert.equal(normalizeProjectAgentChange({
    type: 'chapter.titles',
    summary: '批量补标题',
    titles: [{ targetId: 999, title: '不存在的章' }],
  }, project), null);
  assert.equal(normalizeProjectAgentChange({ type: 'chapter.titles', summary: '批量补标题', titles: [] }, project), null);
});

test('批量标题：一次最多接受 400 章，超出的截断而不是整项失败', () => {
  const many = {
    ...project,
    chapters: Array.from({ length: 500 }, (_, index) => ({ id: index + 1, title: `第 ${index + 1} 章`, content: '正文。', wordCount: 3, createdAt: now, updatedAt: now })),
  } as unknown as Project;
  const change = normalizeProjectAgentChange({
    type: 'chapter.titles',
    summary: '批量补标题',
    titles: Array.from({ length: 500 }, (_, index) => ({ targetId: index + 1, title: `标题 ${index + 1}` })),
  }, many);

  assert.equal(change?.type === 'chapter.titles' ? change.titles.length : 0, 400);
});

test('批量标题不做冲突快照：落地时按章重新取当前标题和正文', () => {
  const change = normalizeProjectAgentChange({
    type: 'chapter.titles',
    summary: '批量补标题',
    titles: [{ targetId: 10, title: '第 1 章 入城' }],
  }, project);

  assert.equal(change?.baseUpdatedAt, undefined);
});
