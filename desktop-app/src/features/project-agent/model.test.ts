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

test('拆章：切点去重排序，标题原样保留，正文不进变更', () => {
  const change = normalizeProjectAgentChange({
    type: 'chapter.parts',
    summary: '拆分超长章节（1 章拆成 3 章）',
    splits: [{ targetId: 10, paragraphCount: 9, breakAfter: [6, 3, 3], titles: ['第 1 章 入城', '雨里的门牌', '空屋'] }],
  }, project);

  assert.equal(change?.type, 'chapter.parts');
  assert.deepEqual(change?.type === 'chapter.parts' ? change.splits : [], [
    { targetId: 10, paragraphCount: 9, breakAfter: [3, 6], titles: ['第 1 章 入城', '雨里的门牌', '空屋'] },
  ]);
  assert.equal(JSON.stringify(change).includes('林舟抵达城南'), false);
});

test('拆章：标题数对不上切点数的整条丢弃，不给新章留无名占位', () => {
  assert.equal(normalizeProjectAgentChange({
    type: 'chapter.parts',
    summary: '拆分超长章节',
    splits: [{ targetId: 10, paragraphCount: 9, breakAfter: [3, 6], titles: ['第 1 章 入城', '雨里的门牌'] }],
  }, project), null);
  assert.equal(normalizeProjectAgentChange({
    type: 'chapter.parts',
    summary: '拆分超长章节',
    splits: [{ targetId: 10, paragraphCount: 9, breakAfter: [3], titles: ['第 1 章 入城', '   '] }],
  }, project), null);
});

test('拆章：切点越界或章节不存在的丢掉，其余照常保留', () => {
  const change = normalizeProjectAgentChange({
    type: 'chapter.parts',
    summary: '拆分超长章节',
    splits: [
      { targetId: 10, paragraphCount: 4, breakAfter: [4], titles: ['第 1 章 入城', '越界的切点'] },
      { targetId: 999, paragraphCount: 9, breakAfter: [3], titles: ['不存在的章', '也不存在'] },
      { targetId: 20, paragraphCount: 6, breakAfter: [3], titles: ['第 2 章 夜雨', '窗外'] },
    ],
  }, project);

  assert.deepEqual(change?.type === 'chapter.parts' ? change.splits.map(item => item.targetId) : [], [20]);
});

test('拆章：没有切点或一条都没剩下时整项丢弃', () => {
  assert.equal(normalizeProjectAgentChange({
    type: 'chapter.parts',
    summary: '拆分超长章节',
    splits: [{ targetId: 10, paragraphCount: 9, breakAfter: [], titles: ['第 1 章 入城'] }],
  }, project), null);
  assert.equal(normalizeProjectAgentChange({ type: 'chapter.parts', summary: '拆分超长章节', splits: [] }, project), null);
});
