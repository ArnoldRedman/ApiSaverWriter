/**
 * 基础爬虫类
 */

export interface NovelRanking {
  platform: string;
  rankType: string;
  position: number;
  title: string;
  author: string;
  url: string;
  coverUrl?: string;
  description?: string;
  wordCount?: number;
  tags?: string[];
  score?: number;
}

export interface ScraperOptions {
  timeout?: number;
  retries?: number;
  delay?: number; // 延迟时间，避免被封
  proxy?: string;
}

export abstract class BaseScraper {
  protected options: Required<ScraperOptions>;

  constructor(options: ScraperOptions = {}) {
    this.options = {
      timeout: options.timeout || 10000,
      retries: options.retries || 3,
      delay: options.delay || 1000,
      proxy: options.proxy || '',
    };
  }

  /**
   * 抓取榜单
   */
  abstract scrapeRankings(rankType: string): Promise<NovelRanking[]>;

  /**
   * 抓取小说详情
   */
  abstract scrapeNovelDetail(url: string): Promise<any>;

  /**
   * 抓取章节列表
   */
  abstract scrapeChapterList(novelUrl: string): Promise<any[]>;

  /**
   * 抓取章节内容
   */
  abstract scrapeChapterContent(chapterUrl: string): Promise<string>;

  /**
   * 延迟执行
   */
  protected async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 带重试的请求
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let i = 0; i < this.options.retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.options.timeout
        );

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            ...options.headers,
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok && i < this.options.retries - 1) {
          await this.sleep(this.options.delay * (i + 1));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        if (i < this.options.retries - 1) {
          await this.sleep(this.options.delay * (i + 1));
        }
      }
    }

    throw lastError || new Error('Request failed');
  }
}
