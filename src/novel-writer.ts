/**
 * ApiSaverWriter - AI 小说写作助手主入口
 */

import { FanqieScraper } from './scrapers/fanqie-scraper.js';
import { BookAnalyzer } from './analysis/book-analyzer.js';
import { SkillManager } from './skills/skill-manager.js';

export interface NovelProject {
  id?: number;
  title: string;
  author?: string;
  genre?: string;
  synopsis?: string;
}

export interface WriterConfig {
  dbPath?: string;
  apiEndpoint?: string;
  apiKey?: string;
  model?: string;
}

/**
 * 主写作助手类
 */
export class NovelWriter {
  private scraper: FanqieScraper;
  private analyzer: BookAnalyzer;
  private skillManager: SkillManager;

  constructor(config: WriterConfig = {}) {
    const dbPath = config.dbPath || './novel-writer.db';
    
    this.scraper = new FanqieScraper();
    this.analyzer = new BookAnalyzer();
    this.skillManager = new SkillManager(dbPath);
  }

  /**
   * 扫榜 - 获取热门小说列表
   */
  async scanRankings(platform: string = 'fanqie', rankType: string = 'hot') {
    if (platform === 'fanqie') {
      return await this.scraper.scrapeRankings(rankType);
    }
    throw new Error(`Unsupported platform: ${platform}`);
  }

  /**
   * 拆书 - 分析小说结构和技巧
   */
  async analyzeNovel(novelUrl: string) {
    // 1. 抓取小说详情
    const detail = await this.scraper.scrapeNovelDetail(novelUrl);
    if (!detail) {
      throw new Error('Failed to fetch novel details');
    }

    // 2. 抓取章节列表
    const chapters = await this.scraper.scrapeChapterList(novelUrl);
    
    // 3. 分析前几章（示例：前5章）
    const analysisResults = [];
    const chaptersToAnalyze = chapters.slice(0, 5);

    for (const chapter of chaptersToAnalyze) {
      const content = await this.scraper.scrapeChapterContent(chapter.url);
      if (content) {
        const analysis = await this.analyzer.analyzeChapter(
          content,
          chapter.title,
          chapter.number
        );
        analysisResults.push(analysis);
      }
    }

    // 4. 从分析结果中提取技能
    const extractedSkills = this.extractSkillsFromAnalysis(analysisResults);

    return {
      novel: detail,
      totalChapters: chapters.length,
      analyzed: analysisResults,
      extractedSkills,
    };
  }

  /**
   * 从分析结果中提取可复用技能
   */
  private extractSkillsFromAnalysis(analyses: any[]) {
    const skillMap = new Map<string, any>();

    for (const analysis of analyses) {
      for (const technique of analysis.techniques) {
        const key = `${technique.category}-${technique.name}`;
        
        if (skillMap.has(key)) {
          // 已存在，增加示例
          const existing = skillMap.get(key);
          existing.examples.push(technique.example);
          existing.count++;
        } else {
          // 新技能
          skillMap.set(key, {
            name: technique.name,
            category: technique.category,
            description: technique.description,
            examples: [technique.example],
            count: 1,
          });
        }
      }
    }

    // 转换为数组，按使用频率排序
    return Array.from(skillMap.values())
      .sort((a, b) => b.count - a.count)
      .map(skill => ({
        name: skill.name,
        category: skill.category,
        description: skill.description,
        content: skill.examples.join('\n\n'),
        tags: [skill.category],
      }));
  }

  /**
   * 技能管理
   */
  get skills() {
    return {
      search: (options: any) => this.skillManager.searchSkills(options),
      get: (id: number) => this.skillManager.getSkill(id),
      add: (skill: any) => this.skillManager.addSkill(skill),
      update: (id: number, skill: any) => this.skillManager.updateSkill(id, skill),
      delete: (id: number) => this.skillManager.deleteSkill(id),
      recordUsage: (id: number) => this.skillManager.recordUsage(id),
    };
  }

  /**
   * 关闭所有连接
   */
  close() {
    this.skillManager.close();
  }
}

// 导出所有模块
export { FanqieScraper } from './scrapers/fanqie-scraper.js';
export { BookAnalyzer } from './analysis/book-analyzer.js';
export { SkillManager } from './skills/skill-manager.js';
export type { NovelRanking } from './scrapers/base-scraper.js';
export type { ChapterAnalysisResult, TechniqueExtraction } from './analysis/book-analyzer.js';
export type { Skill, SkillSearchOptions } from './skills/skill-manager.js';
