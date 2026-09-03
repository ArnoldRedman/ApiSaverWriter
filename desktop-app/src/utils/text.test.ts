import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitChapterTitleHeading, applyDraftChapterTitle, cleanChapterTitleName, isPlaceholderChapterTitle } from './text.ts';

test('章节草稿标题：正文开头的 # 标题被剥出来，重复标题行只取第一行', () => {
  const split = splitChapterTitleHeading('# 第 151 章 黑暗中的后退\n# 第 151 章 黑暗中的后退\n\n林砚僵在门前。');
  assert.equal(split.title, '第 151 章 黑暗中的后退');
  assert.equal(split.content, '林砚僵在门前。');
});

test('章节草稿标题：正文里合法的 Markdown 小节不当成章节标题', () => {
  const split = splitChapterTitleHeading('## 他终究还是回头了，可惜太晚。\n\n后面还有正文。');
  assert.equal(split.title, '');
  assert.equal(split.content, '## 他终究还是回头了，可惜太晚。\n\n后面还有正文。');
});

test('章节草稿标题：占位编号标题补上标题名，章号沿用应用自己的编号', () => {
  assert.equal(applyDraftChapterTitle('第 4 章', '第四章 夜访寒潭'), '第 4 章 夜访寒潭');
  assert.equal(applyDraftChapterTitle('第 4 章', '夜访寒潭'), '第 4 章 夜访寒潭');
  assert.equal(applyDraftChapterTitle('第 4 章', '第四章：夜访寒潭'), '第 4 章 夜访寒潭');
});

test('章节草稿标题：没有章号的占位标题只取标题名，不采用模型数的章号', () => {
  // “新章节”是插在书中间的，模型数的章号大概率对不上真实位置，只留标题名
  assert.equal(applyDraftChapterTitle('新章节', '第四章 夜访寒潭'), '夜访寒潭');
  assert.equal(applyDraftChapterTitle('', '夜访寒潭'), '夜访寒潭');
});

test('章节草稿标题：作者已经起过名的章节不被模型标题覆盖', () => {
  assert.equal(applyDraftChapterTitle('第 4 章 旧城门', '第四章 夜访寒潭'), '第 4 章 旧城门');
  assert.equal(applyDraftChapterTitle('楔子', '第四章 夜访寒潭'), '楔子');
});

test('章节草稿标题：模型只写了章号没写标题名时保持占位标题', () => {
  assert.equal(applyDraftChapterTitle('第 4 章', '第四章'), '第 4 章');
  assert.equal(applyDraftChapterTitle('第 4 章', ''), '第 4 章');
});

test('占位标题判定：批量补标题按它挑出还没有名字的章节', () => {
  for (const title of ['第 12 章', '第十二章', '新章节', '未命名章节', '无标题', '  ', '']) {
    assert.equal(isPlaceholderChapterTitle(title), true, title);
  }
  for (const title of ['第 12 章 夜雨敲窗', '夜雨敲窗', '楔子']) {
    assert.equal(isPlaceholderChapterTitle(title), false, title);
  }
});

test('标题清洗：模型带回的书名号、引号和句末标点逐层剥掉', () => {
  assert.equal(cleanChapterTitleName('《夜雨敲窗》。'), '夜雨敲窗');
  assert.equal(cleanChapterTitleName('“夜雨敲窗”'), '夜雨敲窗');
  assert.equal(cleanChapterTitleName('夜雨敲窗！？'), '夜雨敲窗');
  // 多行只取第一行：模型偶尔在标题后面接一句说明
  assert.equal(cleanChapterTitleName('夜雨敲窗\n（本章完）'), '夜雨敲窗');
  // 正常标题里的标点不该被误剥
  assert.equal(cleanChapterTitleName('夜雨，敲窗人'), '夜雨，敲窗人');
});
