/**
 * 番茄小说爬虫
 */

import { BaseScraper, NovelRanking } from './base-scraper.js';

export class FanqieScraper extends BaseScraper {
  private readonly baseUrl = 'https://fanqienovel.com';

  /**
   * 抓取榜单
   */
  async scrapeRankings(rankType: string = 'hot'): Promise<NovelRanking[]> {
    const rankUrls: Record<string, string> = {
      hot: '/page/rank/hot',
      recommend: '/page/rank/recommend',
      new: '/page/rank/new',
      complete: '/page/rank/complete',
    };

    const url = `${this.baseUrl}${rankUrls[rankType] || rankUrls.hot}`;
    
    try {
      const response = await this.fetchWithRetry(url);
      const html = await response.text();
      
      return this.parseRankingPage(html, rankType);
    } catch (error) {
      console.error('抓取番茄榜单失败:', error);
      return [];
    }
  }

  /**
   * 解析榜单页面
   */
  private parseRankingPage(html: string, rankType: string): NovelRanking[] {
    const rankings: NovelRanking[] = [];
    
    // 使用正则提取数据（避免引入 cheerio 依赖）
    const itemRegex = /<div class="rank-item"[\s\S]*?data-book-id="(\d+)"[\s\S]*?<img.*?src="(.*?)"[\s\S]*?<h3.*?>(.*?)<\/h3>[\s\S]*?<span class="author">(.*?)<\/span>[\s\S]*?<p class="intro">(.*?)<\/p>[\s\S]*?<span class="word-count">(.*?)<\/span>/g;
    
    let match;
    let position = 1;
    
    while ((match = itemRegex.exec(html)) !== null) {
      const [, bookId, coverUrl, title, author, description, wordCountStr] = match;
      
      rankings.push({
        platform: 'fanqie',
        rankType,
        position: position++,
        title: title.trim(),
        author: author.trim(),
        url: `${this.baseUrl}/page/${bookId}`,
        coverUrl: coverUrl,
        description: description.trim(),
        wordCount: this.parseWordCount(wordCountStr),
        tags: [],
      });
    }
    
    return rankings;
  }

  /**
   * 抓取小说详情
   */
  async scrapeNovelDetail(url: string) {
    try {
      const response = await this.fetchWithRetry(url);
      const html = await response.text();
      
      // 提取基本信息
      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/);
      const authorMatch = html.match(/<span class="author-name">(.*?)<\/span>/);
      const descMatch = html.match(/<div class="intro">([\s\S]*?)<\/div>/);
      const tagsMatch = html.match(/<span class="tag">(.*?)<\/span>/g);
      const wordCountMatch = html.match(/字数：([\d.]+万?)/);
      
      return {
        title: titleMatch?.[1]?.trim(),
        author: authorMatch?.[1]?.trim(),
        description: descMatch?.[1]?.replace(/<[^>]+>/g, '').trim(),
        tags: tagsMatch?.map(tag => tag.replace(/<[^>]+>/g, '').trim()) || [],
        wordCount: this.parseWordCount(wordCountMatch?.[1] || '0'),
      };
    } catch (error) {
      console.error('抓取小说详情失败:', error);
      return null;
    }
  }

  /**
   * 抓取章节列表
   */
  async scrapeChapterList(novelUrl: string) {
    const bookId = novelUrl.match(/\/page\/(\d+)/)?.[1];
    if (!bookId) {
      throw new Error('Invalid novel URL');
    }

    try {
      const catalogUrl = `${this.baseUrl}/page/${bookId}/catalog`;
      const response = await this.fetchWithRetry(catalogUrl);
      const html = await response.text();
      
      const chapters: any[] = [];
      const chapterRegex = /<a href="(\/reader\/\d+\/\d+)"[^>]*>(.*?)<\/a>/g;
      
      let match;
      let chapterNum = 1;
      
      while ((match = chapterRegex.exec(html)) !== null) {
        const [, path, title] = match;
        chapters.push({
          number: chapterNum++,
          title: title.trim(),
          url: `${this.baseUrl}${path}`,
        });
      }
      
      return chapters;
    } catch (error) {
      console.error('抓取章节列表失败:', error);
      return [];
    }
  }

  /**
   * 抓取章节内容
   */
  async scrapeChapterContent(chapterUrl: string): Promise<string> {
    try {
      await this.sleep(this.options.delay); // 避免请求过快
      
      const response = await this.fetchWithRetry(chapterUrl);
      const html = await response.text();
      
      // 提取正文内容
      const contentMatch = html.match(/<div class="muye-reader-content[^>]*>([\s\S]*?)<\/div>/);
      if (!contentMatch) {
        return '';
      }
      
      // 清理 HTML 标签，保留段落
      const content = contentMatch[1]
        .replace(/<p[^>]*>/g, '\n')
        .replace(/<\/p>/g, '')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      
      return content;
    } catch (error) {
      console.error('抓取章节内容失败:', chapterUrl, error);
      return '';
    }
  }

  /**
   * 解析字数（支持"万"单位）
   */
  private parseWordCount(str: string): number {
    const numStr = str.replace(/[^\d.]/g, '');
    const num = parseFloat(numStr);
    
    if (str.includes('万')) {
      return Math.round(num * 10000);
    }
    
    return Math.round(num);
  }
}
