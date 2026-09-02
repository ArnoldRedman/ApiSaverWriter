import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeGithubProject, githubMergeChanged } from './github-merge.ts';
import type { Project } from './project.ts';

const early = '2026-01-01T00:00:00.000Z';
const late = '2026-02-01T00:00:00.000Z';

const chapter = (id: number, title: string, content: string, updatedAt = early) =>
  ({ id, title, content, wordCount: content.length, createdAt: early, updatedAt });

const project = (extra: Partial<Project>): Project => ({
  id: 1, title: '同一本书', genre: '悬疑', status: 'writing',
  chapters: [], outline: [], outlines: [], cards: [], memories: [], memoryDocuments: [],
  graphNodes: [], graphEdges: [], createdAt: early, updatedAt: early, wordCount: 0,
  ...extra,
} as Project);

test('换行符差异不算改动', () => {
  const local = project({ chapters: [chapter(1, '第一章', '上句。\n下句。')] });
  const remote = project({ chapters: [chapter(1, '第一章', '上句。\r\n下句。', late)] });
  const result = mergeGithubProject(local, remote);
  assert.equal(githubMergeChanged(result), false);
  assert.equal(result.project.chapters[0].content, '上句。\n下句。');
});

test('远端独有的章节补回本地，回收站里的不复活', () => {
  const local = project({
    chapters: [chapter(1, '第一章', '甲')],
    deletedChapters: [{ chapter: chapter(9, '废稿', '丢掉'), index: 1, deletedAt: late }],
  });
  const remote = project({ chapters: [chapter(1, '第一章', '甲'), chapter(2, '第二章', '乙'), chapter(9, '废稿', '丢掉')] });
  const result = mergeGithubProject(local, remote);
  assert.deepEqual(result.addedChapters, ['第二章']);
  assert.deepEqual(result.project.chapters.map(item => item.id), [1, 2]);
});

test('另一端接着往下写：取长的那版，不算冲突', () => {
  const local = project({ chapters: [chapter(1, '第一章', '开头。')] });
  const remote = project({ chapters: [chapter(1, '第一章', '开头。后面又写了一大段。', early)] });
  const result = mergeGithubProject(local, remote);
  assert.deepEqual(result.updatedChapters, ['第一章']);
  assert.deepEqual(result.conflictChapters, []);
  assert.equal(result.project.chapters[0].content, '开头。后面又写了一大段。');
});

test('本地更长时保留本地，远端不覆盖', () => {
  const local = project({ chapters: [chapter(1, '第一章', '开头。后面又写了一大段。')] });
  const remote = project({ chapters: [chapter(1, '第一章', '开头。', late)] });
  const result = mergeGithubProject(local, remote);
  assert.equal(githubMergeChanged(result), false);
  assert.equal(result.project.chapters[0].content, '开头。后面又写了一大段。');
});

test('两边各改各的：保留本地，远端正文进历史版本', () => {
  const local = project({ chapters: [chapter(1, '第一章', '本地写的一大段正文。')] });
  const remote = project({ chapters: [chapter(1, '第一章', '远端写的短句。', late)] });
  const result = mergeGithubProject(local, remote);
  assert.deepEqual(result.conflictChapters, ['第一章']);
  assert.equal(result.project.chapters[0].content, '本地写的一大段正文。');
  assert.equal(result.project.chapters[0].snapshots?.[0].content, '远端写的短句。');
});

test('远端更新且篇幅相当：采用远端，本地正文进历史版本', () => {
  const local = project({ chapters: [chapter(1, '第一章', '甲甲甲甲甲甲甲甲甲甲')] });
  const remote = project({ chapters: [chapter(1, '第一章', '乙乙乙乙乙乙乙乙乙乙', late)] });
  const result = mergeGithubProject(local, remote);
  assert.deepEqual(result.updatedChapters, ['第一章']);
  assert.equal(result.project.chapters[0].content, '乙乙乙乙乙乙乙乙乙乙');
  assert.equal(result.project.chapters[0].snapshots?.[0].content, '甲甲甲甲甲甲甲甲甲甲');
});

test('本地是空壳记忆文档时被远端补全', () => {
  const local = project({ memoryDocuments: [{ id: 'memory-document:时间线', kind: '时间线', title: '时间线', content: '', updatedAt: early }] });
  const remote = project({ memoryDocuments: [
    { id: 'memory-document:时间线', kind: '时间线', title: '时间线', content: '第一天……第十天', updatedAt: early },
    { id: 'memory-document:冲突', kind: '冲突', title: '冲突', content: '主角与宗族', updatedAt: early },
  ] });
  const result = mergeGithubProject(local, remote);
  assert.equal(result.otherUpdates, 2);
  assert.equal(result.project.memoryDocuments[0].content, '第一天……第十天');
});

test('整本级字段和字数以本地为准', () => {
  const local = project({ title: '本地书名', synopsis: '本地简介', chapters: [chapter(1, '第一章', '十个字十个字')] });
  const remote = project({ title: '远端书名', synopsis: '远端简介', updatedAt: late, chapters: [] });
  const result = mergeGithubProject(local, remote);
  assert.equal(result.project.title, '本地书名');
  assert.equal(result.project.synopsis, '本地简介');
  assert.equal(result.project.wordCount, 6);
});
