# ApiSaverWriter Desktop

桌面端 AI 小说写作助手 - 基于 Tauri + React 构建的跨平台应用

## ✨ 特性

- 🖥️ **跨平台支持**: Windows、macOS、Linux
- ⚡ **轻量高效**: 包体积 ~5MB，内存占用 ~100MB
- 🔒 **安全可靠**: Rust 后端隔离，IPC 白名单机制
- 🎨 **现代 UI**: React + TypeScript，暗色主题
- 🤖 **智能写作**: 集成 LangGraph AI 工作流

## 🏗️ 架构

```
Tauri Window (React)
    ↕ IPC
Rust Backend
    ↕ stdio (JSON-RPC)
Node.js Sidecar (agent-runtime)
    - LangGraph
    - SQLite + FTS5 + Vector
    - LLM API
```

## 🚀 开发

### 前置要求

- Node.js 18+
- Rust 1.70+
- 操作系统特定依赖:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk`, `libssl-dev`, `libgtk-3-dev`
  - **Windows**: WebView2 (通常已预装)

### 安装依赖

```bash
cd desktop-app
npm install
```

### 开发模式

```bash
npm run dev
```

这会启动:
1. Vite 开发服务器 (http://localhost:5173)
2. Tauri 窗口 (热重载)
3. Node.js sidecar (agent-runtime)

### 构建发布

```bash
npm run build
```

生成的安装包位于 `src-tauri/target/release/bundle/`

## 📁 项目结构

```
desktop-app/
├── src/                    # React 前端代码
│   ├── App.tsx            # 主应用组件
│   ├── App.css            # 样式
│   └── main.tsx           # 入口文件
├── src-tauri/             # Tauri Rust 后端
│   ├── src/
│   │   └── main.rs        # Rust 主程序
│   ├── Cargo.toml         # Rust 依赖
│   └── tauri.conf.json    # Tauri 配置
└── package.json
```

## 🎨 UI 设计

- **配色方案**: 暗色主题 (#0F1117 背景 + #FBBF24 强调色)
- **字体**: 系统默认 sans-serif
- **布局**: 侧边栏 (280px) + 主编辑区

## 🔌 API

### Tauri Commands

```typescript
// 启动 agent runtime
await invoke('start_agent_runtime')

// 调用 RPC
await invoke('call_agent_rpc', {
  method: 'generateChapter',
  params: { projectId, chapterId, instruction }
})
```

## 📝 TODO

- [ ] 实现完整的 stdio 双向通信
- [ ] 添加流式输出支持
- [ ] 人物/地点/伏笔管理面板
- [ ] 项目管理功能
- [ ] 设置页面 (API Key 配置)
- [ ] 导出功能 (TXT, EPUB, PDF)

## 🛠️ 技术栈

- **前端**: React 19 + TypeScript
- **桌面框架**: Tauri 2.0
- **后端**: Rust (IPC + Sidecar 管理)
- **构建工具**: Vite 8
- **AI 引擎**: ../sidecars/agent-runtime

## 📄 许可证

MIT
