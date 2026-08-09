# 技术架构文档

## 系统概述

ApiSaverWriter 是一个基于 TypeScript + SQLite + Tauri 的桌面小说写作应用，采用前后端分离架构。

## 技术栈

### 后端
- **语言**: TypeScript (ES2022)
- **数据库**: SQLite3 + better-sqlite3
- **全文搜索**: FTS5 (SQLite Full-Text Search)
- **网络请求**: node-fetch
- **HTML 解析**: cheerio

### 前端
- **框架**: React 18 + TypeScript
- **桌面框架**: Tauri 2.x (Rust)
- **构建工具**: Vite 5.x
- **样式**: 纯 CSS (深色主题)

### 测试
- **测试框架**: Vitest
- **覆盖率**: 13 个单元测试，100% 核心功能覆盖

## 数据库设计

### 表结构

#### skills 表（技能库）

```sql
CREATE TABLE skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  tags TEXT,              -- JSON 数组
  examples TEXT,          -- JSON 数组
  rating REAL DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  is_builtin BOOLEAN DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_rating ON skills(rating);
```

#### skills_fts 表（全文搜索）

```sql
CREATE VIRTUAL TABLE skills_fts USING fts5(
  name, 
  description, 
  content,
  content=skills,
  content_rowid=id,
  tokenize='unicode61'
);

-- 触发器自动同步
CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts(rowid, name, description, content)
  VALUES (new.id, new.name, new.description, new.content);
END;

CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
  DELETE FROM skills_fts WHERE rowid = old.id;
END;

CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
  UPDATE skills_fts 
  SET name = new.name,
      description = new.description,
      content = new.content
  WHERE rowid = old.id;
END;
```

## 核心模块

### 1. SkillManager（技能管理）

**职责**：
- 技能的 CRUD 操作
- 全文搜索（FTS5）
- 分类筛选
- 标签管理
- 使用统计

**关键方法**：

```typescript
class SkillManager {
  // 搜索技能（支持全文搜索、分类、标签、评分）
  searchSkills(options?: SkillSearchOptions): Skill[]
  
  // 获取单个技能
  getSkill(id: number): Skill | null
  
  // 添加技能
  addSkill(skill: Omit<Skill, 'id'>): number
  
  // 更新技能
  updateSkill(id: number, updates: Partial<Skill>): void
  
  // 删除技能
  deleteSkill(id: number): void
  
  // 记录使用
  recordUsage(id: number): void
  
  // 加载内置技能
  private loadBuiltinSkills(): void
}
```

**内置技能列表**：
- 冲突开场
- 悬念营造
- 伏笔铺垫
- 情感渲染
- 对话塑造
- 环境烘托
- 心理描写
- 动作描写
- 节奏控制
- 转折设计

### 2. BookAnalyzer（拆书分析）

**职责**：
- 分析章节结构
- 识别写作技巧
- 评估节奏快慢
- 提取可复用技能

**分析维度**：

```typescript
interface ChapterAnalysisResult {
  chapterNumber: number;
  title: string;
  wordCount: number;
  
  // 结构分析
  structure: {
    opening: string;      // 开头方式
    development: string;  // 发展模式
    climax: string;       // 高潮设计
    ending: string;       // 结尾类型
  };
  
  // 节奏分析
  pacing: {
    speed: 'fast' | 'medium' | 'slow';
    rhythm: string;
    avgSentenceLength: number;
  };
  
  // 技巧识别
  techniques: TechniqueExtraction[];
  
  // 可学习点
  learnings: string[];
}
```

**识别规则**：

| 技巧类型 | 识别规则 | 示例 |
|---------|---------|------|
| 对话 | 引号数量 > 3 对 | "你好吗？""很好！" |
| 环境描写 | 包含景物词汇 | 夕阳、微风、花香 |
| 心理描写 | 包含心理动词 | 想到、觉得、担心 |
| 动作描写 | 动作动词密度高 | 跑、跳、推开门 |
| 悬念设置 | 疑问句、省略号 | "那是什么？" |
| 冲突 | 对立情绪词 | 愤怒 vs 冷静 |

### 3. BaseScraper（爬虫基类）

**职责**：
- 定义爬虫接口
- 统一数据格式
- 错误处理

```typescript
interface NovelRanking {
  title: string;        // 书名
  author: string;       // 作者
  category: string;     // 分类
  rank: number;         // 排名
  description?: string; // 简介
  tags?: string[];      // 标签
  url?: string;         // 链接
  cover?: string;       // 封面
  stats?: {            // 数据
    words?: number;
    chapters?: number;
    favorites?: number;
  };
}

abstract class BaseScraper {
  abstract fetchRankings(options?: ScraperOptions): Promise<NovelRanking[]>;
}
```

### 4. FanqieScraper（番茄小说爬虫）

**实现**：
- 抓取番茄小说热榜
- 解析 HTML 结构
- 提取书籍信息

**注意事项**：
- 需要设置正确的 User-Agent
- 遵守 robots.txt
- 控制请求频率（防止被封）
- 处理反爬机制

## 前端架构

### 组件树

```
App
├── Sidebar（侧边栏）
│   ├── Logo
│   └── Nav
│       ├── Projects
│       ├── Skills
│       ├── Rankings
│       └── Analysis
└── Main（主内容）
    ├── ProjectsView
    ├── SkillsView
    ├── RankingsView
    └── AnalysisView
```

### 状态管理

使用 React Hooks（useState + useEffect）进行简单状态管理：

```typescript
const [activeTab, setActiveTab] = useState<TabType>('projects');
const [skills, setSkills] = useState<Skill[]>([]);
const [rankings, setRankings] = useState<NovelRanking[]>([]);
const [loading, setLoading] = useState(false);
```

未来可考虑引入 Zustand 或 Jotai 进行更复杂的状态管理。

### Tauri 集成

**IPC 通信**（前后端调用）：

```rust
// Rust 后端命令
#[tauri::command]
fn search_skills(query: String) -> Vec<Skill> {
    // 调用 TypeScript 核心库
}

#[tauri::command]
fn analyze_chapter(content: String) -> AnalysisResult {
    // 调用分析引擎
}
```

```typescript
// 前端调用
import { invoke } from '@tauri-apps/api/core';

const skills = await invoke('search_skills', { query: '对话' });
const result = await invoke('analyze_chapter', { content });
```

## 性能优化

### 数据库优化

1. **索引策略**
   - category, rating 字段创建索引
   - FTS5 自动建立倒排索引

2. **查询优化**
   - 使用 LIMIT 分页
   - prepared statements 防止 SQL 注入
   - 批量插入使用事务

3. **全文搜索优化**
   - FTS5 使用 BM25 排序算法
   - 支持中文分词（unicode61）
   - 增量索引更新（触发器）

### 前端优化

1. **懒加载**
   - 路由级别代码分割
   - 图片懒加载

2. **虚拟列表**
   - 长列表使用 react-window

3. **防抖节流**
   - 搜索输入防抖
   - 滚动加载节流

## 安全考虑

1. **SQL 注入防护**
   - 使用参数化查询
   - 严格的输入验证

2. **XSS 防护**
   - React 自动转义
   - DOMPurify 清理 HTML

3. **爬虫合规**
   - 遵守 robots.txt
   - 合理的请求间隔
   - 声明 User-Agent

## 部署

### 开发环境

```bash
npm install
cd desktop-app && npm install
npm run tauri dev
```

### 生产构建

```bash
cd desktop-app
npm run tauri build
```

**输出**：
- macOS: `.dmg` 安装包
- Windows: `.exe` 或 `.msi`
- Linux: `.deb` 或 `.AppImage`

## 监控与日志

- 使用 console.log 记录关键操作
- Tauri 提供系统日志集成
- 未来可接入 Sentry 错误追踪

## 扩展性

### 插件系统（规划中）

```typescript
interface WriterPlugin {
  name: string;
  version: string;
  install(writer: NovelWriter): void;
}

// 示例插件
const grammarPlugin: WriterPlugin = {
  name: 'grammar-checker',
  version: '1.0.0',
  install(writer) {
    writer.on('beforeSave', (content) => {
      return checkGrammar(content);
    });
  }
};
```

### AI 集成（规划中）

```typescript
interface AIProvider {
  complete(prompt: string): Promise<string>;
  analyze(text: string): Promise<AnalysisResult>;
}

// OpenAI 实现
class OpenAIProvider implements AIProvider {
  async complete(prompt: string) {
    // 调用 GPT API
  }
}

// Claude 实现
class ClaudeProvider implements AIProvider {
  async complete(prompt: string) {
    // 调用 Claude API
  }
}
```

## 贡献指南

1. Fork 项目
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交改动：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 相关资源

- [Tauri 文档](https://tauri.app/)
- [React 文档](https://react.dev/)
- [SQLite FTS5 文档](https://www.sqlite.org/fts5.html)
- [better-sqlite3 文档](https://github.com/WiseLibs/better-sqlite3)
