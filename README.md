# ApiSaverWriter - AI 小说写作助手

## 下载应用

当前稳定版本：[v0.1.1 Release](https://github.com/Vaxue/ApiSaverWriter/releases/tag/v0.1.1)

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | [EXE 安装包](https://github.com/Vaxue/ApiSaverWriter/releases/download/v0.1.1/ApiSaverWriter_0.1.1_x64-setup.exe) · [MSI 安装包](https://github.com/Vaxue/ApiSaverWriter/releases/download/v0.1.1/ApiSaverWriter_0.1.1_x64_en-US.msi) |
| macOS Apple Silicon | [DMG 安装包](https://github.com/Vaxue/ApiSaverWriter/releases/download/v0.1.1/ApiSaverWriter_v0.1.1_macOS_AppleSilicon.dmg) |
| macOS Intel | [DMG 安装包](https://github.com/Vaxue/ApiSaverWriter/releases/download/v0.1.1/ApiSaverWriter_v0.1.1_macOS_Intel.dmg) |
| Android | [APK 安装包](https://github.com/Vaxue/ApiSaverWriter/releases/download/v0.1.1/app-universal-release-unsigned.apk) · [AAB 包](https://github.com/Vaxue/ApiSaverWriter/releases/download/v0.1.1/app-universal-release.aab) |
| iOS | [未签名 IPA](https://github.com/Vaxue/ApiSaverWriter/releases/download/v0.1.1/ApiSaverWriter_v0.1.1_iOS_unsigned.ipa) |

> iOS IPA 与 Android APK 未签名，需要使用对应设备的安装或签名方式导入。后续版本可从 [Releases](https://github.com/Vaxue/ApiSaverWriter/releases) 页面获取。

## 📖 项目简介

ApiSaverWriter 是一款功能强大的 AI 小说写作助手，参考 QMai 小说的设计理念，提供完整的小说创作工具链。

## ✨ 核心功能

### 1. 📚 项目管理
- 小说项目管理
- 卷/章节组织
- 大纲编辑
- 人物设定
- 世界观设定

### 2. ⚡ 技能库系统
- **内置写作技巧**：冲突开场、悬念营造、情感渲染等
- **风格模板**：不同类型小说的写作风格
- **情节模式**：经典情节结构和套路
- **全文搜索**：快速查找相关技能
- **使用统计**：追踪技能使用频率
- **自定义技能**：添加和管理个人写作技巧

### 3. 📊 扫榜工具
- **番茄小说热榜**：实时抓取热门排行
- **起点中文网**：经典网文平台数据
- **多维度筛选**：按分类、标签、更新时间等
- **趋势分析**：追踪榜单变化趋势

### 4. 🔍 拆书分析
- **章节结构分析**：识别开头、发展、高潮、结尾
- **情节节奏**：分析快慢节奏变化
- **人物塑造**：提取人物描写技巧
- **写作手法**：识别对话、环境、心理等技巧
- **技能提取**：将优秀写法沉淀为可复用技能

## 🏗️ 技术架构

### 后端核心 (TypeScript + SQLite)

```
src/
├── novel-writer.ts          # 主入口
├── skills/
│   └── skill-manager.ts     # 技能管理（FTS5全文搜索）
├── scrapers/
│   ├── base-scraper.ts      # 爬虫基类
│   └── fanqie-scraper.ts    # 番茄小说爬虫
└── analysis/
    └── book-analyzer.ts     # 拆书分析引擎
```

### 前端界面 (React + TypeScript + Tauri)

```
desktop-app/
├── src/
│   ├── App.tsx              # 主界面
│   ├── App.css              # 深色主题样式
│   └── main.tsx             # 入口
└── src-tauri/               # Tauri 桌面应用
```

### 数据库设计

**技能表 (skills)**
- id, name, category, description, content
- tags (JSON), examples (JSON)
- rating, usage_count
- is_builtin, created_at, updated_at

**全文搜索 (skills_fts)**
- FTS5 虚拟表，支持中文分词
- 索引 name, description, content

## 🎨 设计风格

- **配色方案**：深色主题，深海蓝 (#0B0E14) + 天蓝 (#38BDF8)
- **字体**：Inter / SF Pro 系统字体
- **组件**：圆角卡片、悬停动效、渐变强调
- **布局**：侧边栏导航 + 主内容区

## 📦 安装与使用

### 安装依赖

```bash
# 安装根项目依赖
npm install

# 安装桌面应用依赖
cd desktop-app
npm install
```

### 开发模式

```bash
# 启动桌面应用开发服务器
cd desktop-app
npm run tauri dev
```

### 构建生产版本

```bash
cd desktop-app
npm run tauri build
```

### 运行测试

```bash
npm test
```

## 🧪 测试覆盖

- ✅ 技能搜索与管理
- ✅ 技能分类筛选
- ✅ 技能添加、更新、删除
- ✅ 使用统计
- ✅ 章节结构分析
- ✅ 对话技巧识别
- ✅ 节奏分析

## 📚 API 使用示例

### 技能管理

```typescript
import { NovelWriter } from './src/novel-writer.js';

const writer = new NovelWriter();

// 搜索技能
const skills = writer.skills.search({ 
  category: 'technique',
  limit: 10 
});

// 添加自定义技能
const skillId = writer.skills.add({
  name: '场景切换',
  category: 'technique',
  description: '流畅的场景转换技巧',
  content: '使用时间、空间标记明确场景切换...',
  tags: ['场景', '过渡'],
});

// 记录使用
writer.skills.recordUsage(skillId);
```

### 拆书分析

```typescript
import { BookAnalyzer } from './src/analysis/book-analyzer.js';

const analyzer = new BookAnalyzer();

const result = await analyzer.analyzeChapter(
  chapterContent,
  '第一章 重生',
  1
);

console.log(result.structure);  // 章节结构
console.log(result.techniques); // 识别的技巧
console.log(result.pacing);     // 节奏分析
```

### 扫榜工具

```typescript
import { FanqieScraper } from './src/scrapers/fanqie-scraper.js';

const scraper = new FanqieScraper();

const rankings = await scraper.fetchRankings({
  category: '玄幻',
  limit: 20,
});

rankings.forEach(novel => {
  console.log(`${novel.rank}. ${novel.title} - ${novel.author}`);
});
```

## 🚀 未来规划

- [ ] AI 辅助写作（接入 GPT/Claude）
- [ ] 多平台数据源（起点、晋江、17K）
- [ ] 协同编辑功能
- [ ] 云端同步
- [ ] 移动端应用
- [ ] 写作数据统计与可视化
- [ ] 敏感词检测
- [ ] 自动纠错与润色

## 📄 License

MIT

## 👥 贡献

欢迎提交 Issue 和 Pull Request！
