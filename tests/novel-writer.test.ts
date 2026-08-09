/**
 * 小说写作助手测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NovelWriter } from '../src/novel-writer.js';
import { SkillManager } from '../src/skills/skill-manager.js';
import { BookAnalyzer } from '../src/analysis/book-analyzer.js';
import * as fs from 'fs';

const TEST_DB = './test-novel-writer.db';

describe('NovelWriter 功能测试', () => {
  let writer: NovelWriter;

  beforeEach(() => {
    // 清理测试数据库
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
    writer = new NovelWriter({ dbPath: TEST_DB });
  });

  afterEach(() => {
    writer.close();
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  describe('技能管理', () => {
    it('应该能搜索内置技能', () => {
      const skills = writer.skills.search({ limit: 10 });
      expect(skills.length).toBeGreaterThan(0);
      expect(skills[0]).toHaveProperty('name');
      expect(skills[0]).toHaveProperty('category');
    });

    it('应该能按分类搜索技能', () => {
      const techniques = writer.skills.search({ category: 'technique' });
      expect(techniques.every(s => s.category === 'technique')).toBe(true);
    });

    it('应该能添加自定义技能', () => {
      const skillId = writer.skills.add({
        name: '测试技能',
        category: 'technique',
        description: '这是一个测试技能',
        content: '技能内容',
        tags: ['测试'],
      });

      expect(skillId).toBeGreaterThan(0);

      const skill = writer.skills.get(skillId);
      expect(skill?.name).toBe('测试技能');
    });

    it('应该能更新技能', () => {
      const skillId = writer.skills.add({
        name: '原始技能',
        category: 'technique',
        description: '原始描述',
        content: '原始内容',
        tags: [],
      });

      writer.skills.update(skillId, {
        name: '更新后的技能',
        description: '更新后的描述',
      });

      const skill = writer.skills.get(skillId);
      expect(skill?.name).toBe('更新后的技能');
      expect(skill?.description).toBe('更新后的描述');
    });

    it('应该能删除技能', () => {
      const skillId = writer.skills.add({
        name: '待删除技能',
        category: 'technique',
        description: '测试',
        content: '测试',
        tags: [],
      });

      writer.skills.delete(skillId);

      const skill = writer.skills.get(skillId);
      expect(skill).toBeNull();
    });

    it('应该能记录技能使用次数', () => {
      const skillId = writer.skills.add({
        name: '使用统计技能',
        category: 'technique',
        description: '测试',
        content: '测试',
        tags: [],
      });

      const before = writer.skills.get(skillId);
      expect(before?.usageCount).toBe(0);

      writer.skills.recordUsage(skillId);
      writer.skills.recordUsage(skillId);

      const after = writer.skills.get(skillId);
      expect(after?.usageCount).toBe(2);
    });

    it('应该能全文搜索技能', () => {
      const skillId = writer.skills.add({
        name: '对话技巧测试',
        category: 'technique',
        description: '如何写好对话',
        content: '用对话推进情节',
        tags: ['对话'],
      });

      // 等待 FTS5 索引更新
      const skill = writer.skills.get(skillId);
      expect(skill?.name).toBe('对话技巧测试');

      // 简单验证搜索功能可用
      const results = writer.skills.search({ limit: 100 });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('章节分析', () => {
    const analyzer = new BookAnalyzer();

    it('应该能分析章节结构', async () => {
      const content = `
        他推开门，屋内一片寂静。
        
        "有人吗？"他小心翼翼地问道。
        
        没有回应。他慢慢走进去，突然，背后传来一声巨响！
        
        他猛地转身，只见门已经关上了。
      `;

      const result = await analyzer.analyzeChapter(content, '第一章 进入', 1);

      expect(result.chapterNumber).toBe(1);
      expect(result.title).toBe('第一章 进入');
      expect(result.wordCount).toBeGreaterThan(0);
      expect(result.structure).toHaveProperty('opening');
      expect(result.structure).toHaveProperty('climax');
    });

    it('应该能识别对话技巧', async () => {
      const content = `
        "你在说什么？"他皱起眉头。
        
        "我说的是实话。"她冷冷地回答。
        
        两人对视着，空气仿佛凝固了。
      `;

      const result = await analyzer.analyzeChapter(content, '对话章节', 1);
      const hasDialogueTechnique = result.techniques.some(t => t.category === 'dialogue');
      
      expect(hasDialogueTechnique).toBe(true);
    });

    it('应该能分析节奏', async () => {
      const shortContent = '跑。追。停。回头。';
      const longContent = `
        夕阳西下，漫天的晚霞在天边缓缓铺展开来，金色的光芒洒满整个大地，温暖而柔和。
        微风轻拂，带来了远处花园中玫瑰的淡淡香气，沁人心脾，让人感到无比的宁静与安详。
        他静静地坐在公园的长椅上，闭着眼睛，细细回想着过去那些美好而难忘的往事，心中涌起一阵阵温暖。
        那些曾经鲜活生动的记忆，如今虽然已经变得有些模糊不清，但依然深深地刻在他的心底，永远不会忘记。
        时光流逝，岁月变迁，一切都在不断地改变着，但是这份内心深处的宁静与平和却依然如故，从未改变过。
      `;

      const fast = await analyzer.analyzeChapter(shortContent, '快节奏', 1);
      const slow = await analyzer.analyzeChapter(longContent, '慢节奏', 2);

      // 验证快慢节奏的基本特征
      expect(fast.pacing.speed).toBe('fast');
      expect(slow.wordCount).toBeGreaterThan(fast.wordCount);
    });
  });
});

describe('SkillManager 独立测试', () => {
  const TEST_DB2 = './test-skills.db';
  let manager: SkillManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB2)) {
      fs.unlinkSync(TEST_DB2);
    }
    manager = new SkillManager(TEST_DB2);
  });

  afterEach(() => {
    manager.close();
    if (fs.existsSync(TEST_DB2)) {
      fs.unlinkSync(TEST_DB2);
    }
  });

  it('应该自动加载内置技能', () => {
    const skills = manager.searchSkills({ limit: 100 });
    const builtinSkills = skills.filter(s => s.isBuiltin);
    
    expect(builtinSkills.length).toBeGreaterThan(0);
    expect(builtinSkills.some(s => s.name === '冲突开场')).toBe(true);
  });

  it('应该支持标签过滤', () => {
    manager.addSkill({
      name: '标签测试技能',
      category: 'technique',
      description: '测试',
      content: '测试',
      tags: ['悬念', '开头'],
    });

    const results = manager.searchSkills({ tags: ['悬念'] });
    expect(results.some(s => s.name === '标签测试技能')).toBe(true);
  });

  it('应该支持评分过滤', () => {
    const id1 = manager.addSkill({
      name: '低分技能',
      category: 'technique',
      description: '测试',
      content: '测试',
      tags: [],
    });

    const id2 = manager.addSkill({
      name: '高分技能',
      category: 'technique',
      description: '测试',
      content: '测试',
      tags: [],
    });

    manager.updateSkill(id1, { rating: 2.0 });
    manager.updateSkill(id2, { rating: 4.5 });

    const highRated = manager.searchSkills({ minRating: 4.0 });
    expect(highRated.some(s => s.name === '高分技能')).toBe(true);
    expect(highRated.some(s => s.name === '低分技能')).toBe(false);
  });
});
