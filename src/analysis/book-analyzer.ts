/**
 * 拆书分析器 - 分析小说结构、节奏、技巧
 */

export interface ChapterStructure {
  opening: string;      // 开头方式
  development: string;  // 发展过程
  climax: string;       // 高潮部分
  ending: string;       // 结尾方式
}

export interface PacingAnalysis {
  speed: 'fast' | 'medium' | 'slow';
  description: string;
  keyMoments: string[];
}

export interface TechniqueExtraction {
  name: string;
  description: string;
  example: string;
  category: string;
}

export interface ChapterAnalysisResult {
  chapterNumber: number;
  title: string;
  wordCount: number;
  structure: ChapterStructure;
  pacing: PacingAnalysis;
  techniques: TechniqueExtraction[];
  characterDevelopment: string[];
  keyPlotPoints: string[];
}

export class BookAnalyzer {
  /**
   * 分析单个章节
   */
  async analyzeChapter(
    chapterContent: string,
    chapterTitle: string,
    chapterNumber: number
  ): Promise<ChapterAnalysisResult> {
    const paragraphs = chapterContent.split('\n').filter(p => p.trim());
    const wordCount = chapterContent.length;

    return {
      chapterNumber,
      title: chapterTitle,
      wordCount,
      structure: this.analyzeStructure(paragraphs),
      pacing: this.analyzePacing(paragraphs, wordCount),
      techniques: this.extractTechniques(chapterContent),
      characterDevelopment: this.analyzeCharacters(chapterContent),
      keyPlotPoints: this.extractKeyPoints(paragraphs),
    };
  }

  /**
   * 分析章节结构
   */
  private analyzeStructure(paragraphs: string[]): ChapterStructure {
    const totalParas = paragraphs.length;
    
    // 简单分段：前15%为开头，中间70%为发展，最后15%为结尾
    const openingEnd = Math.floor(totalParas * 0.15);
    const climaxStart = Math.floor(totalParas * 0.7);
    
    const opening = paragraphs.slice(0, openingEnd).join('\n');
    const development = paragraphs.slice(openingEnd, climaxStart).join('\n');
    const climax = paragraphs.slice(climaxStart, -Math.floor(totalParas * 0.15)).join('\n');
    const ending = paragraphs.slice(-Math.floor(totalParas * 0.15)).join('\n');

    return {
      opening: this.summarizeSection(opening, '开头'),
      development: this.summarizeSection(development, '发展'),
      climax: this.summarizeSection(climax, '高潮'),
      ending: this.summarizeSection(ending, '结尾'),
    };
  }

  /**
   * 分析节奏
   */
  private analyzePacing(paragraphs: string[], wordCount: number): PacingAnalysis {
    const avgParaLength = wordCount / paragraphs.length;
    
    // 根据平均段落长度判断节奏
    let speed: 'fast' | 'medium' | 'slow';
    let description: string;
    
    if (avgParaLength < 50) {
      speed = 'fast';
      description = '节奏紧凑，多用短句短段，适合动作场景和紧张情节';
    } else if (avgParaLength < 100) {
      speed = 'medium';
      description = '节奏适中，叙述和对话平衡，适合日常推进';
    } else {
      speed = 'slow';
      description = '节奏舒缓，多用长段落，适合环境描写和心理描写';
    }

    // 提取关键时刻（包含动作、对话、情绪词的段落）
    const keyMoments = paragraphs
      .filter(p => 
        /["「『]/.test(p) || // 包含对话
        /！|？|……/.test(p) || // 包含强调
        /(突然|瞬间|立刻|马上|忽然)/.test(p) // 包含转折词
      )
      .slice(0, 5);

    return { speed, description, keyMoments };
  }

  /**
   * 提取写作技巧
   */
  private extractTechniques(content: string): TechniqueExtraction[] {
    const techniques: TechniqueExtraction[] = [];

    // 检测对话技巧
    if (/"[^"]{20,}"|「[^」]{20,}」/.test(content)) {
      techniques.push({
        name: '对话推进',
        description: '通过人物对话推动情节发展',
        example: content.match(/"[^"]{20,100}"|「[^」]{20,100}」/)?.[0] || '',
        category: 'dialogue',
      });
    }

    // 检测环境描写
    if (/(天空|阳光|月光|风|雨|雪|云|星).{10,50}/.test(content)) {
      techniques.push({
        name: '环境渲染',
        description: '通过环境描写营造氛围',
        example: content.match(/(天空|阳光|月光|风|雨|雪|云|星).{10,50}/)?.[0] || '',
        category: 'description',
      });
    }

    // 检测心理描写
    if (/(想到|心想|觉得|感觉|似乎|仿佛).{10,50}/.test(content)) {
      techniques.push({
        name: '心理刻画',
        description: '展现人物内心活动',
        example: content.match(/(想到|心想|觉得|感觉|似乎|仿佛).{10,50}/)?.[0] || '',
        category: 'psychology',
      });
    }

    // 检测悬念设置
    if (/(但是|然而|突然|忽然|不料|竟然).{10,50}/.test(content)) {
      techniques.push({
        name: '悬念制造',
        description: '通过转折和意外制造悬念',
        example: content.match(/(但是|然而|突然|忽然|不料|竟然).{10,50}/)?.[0] || '',
        category: 'suspense',
      });
    }

    // 检测动作描写
    if (/(冲|跑|跳|打|踢|抓|扔|推|拉).{5,30}/.test(content)) {
      techniques.push({
        name: '动作描写',
        description: '通过连续动作增强画面感',
        example: content.match(/(冲|跑|跳|打|踢|抓|扔|推|拉).{5,30}/)?.[0] || '',
        category: 'action',
      });
    }

    return techniques;
  }

  /**
   * 分析人物发展
   */
  private analyzeCharacters(content: string): string[] {
    const characters: string[] = [];
    
    // 提取出现的人物名称（简单方法：常见称呼）
    const pattern = /([A-Z][a-z]+|[\u4e00-\u9fa5]{2,4})(说|道|笑|怒|叹|想|看)/g;
    
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (!characters.includes(name)) {
        characters.push(name);
      }
    }

    return characters.slice(0, 5); // 最多返回5个主要人物
  }

  /**
   * 提取关键情节点
   */
  private extractKeyPoints(paragraphs: string[]): string[] {
    // 寻找包含关键转折词的段落
    const keyWords = ['决定', '发现', '意识到', '突然', '终于', '原来', '竟然', '没想到'];
    
    return paragraphs
      .filter(p => keyWords.some(kw => p.includes(kw)))
      .map(p => p.substring(0, 100))
      .slice(0, 3);
  }

  /**
   * 总结章节片段
   */
  private summarizeSection(text: string, sectionName: string): string {
    if (!text || text.length < 50) {
      return `${sectionName}部分内容较短`;
    }

    // 简单总结：取前100字 + 识别开头技巧
    const preview = text.substring(0, 100);
    
    const techniques = [];
    if (/"[^"]+"|「[^」]+」/.test(text)) techniques.push('对话开场');
    if (/(天空|环境|场景)/.test(text)) techniques.push('环境描写');
    if (/(想|心|觉得)/.test(text)) techniques.push('心理活动');
    if (/(突然|忽然|瞬间)/.test(text)) techniques.push('情节转折');

    return techniques.length > 0
      ? `${techniques.join('、')}。示例：${preview}...`
      : preview + '...';
  }
}
