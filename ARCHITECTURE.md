# ApiSaverWriter 架构

本文只描述当前仓库中的实际实现。产品功能和使用方式见 [README.md](README.md)，未完成事项见 [TODO.md](TODO.md)。

## 总体结构

```text
ApiSaverWriter/
├── desktop-app/                React + TypeScript + Tauri 客户端
│   ├── src/App.tsx             主界面与业务状态
│   ├── src/platform.ts         桌面 invoke 包装与移动端直连实现
│   └── src-tauri/src/lib.rs    原生存储、备份、系统能力和桌面 Agent 进程管理
├── sidecars/agent-runtime/     Node.js/TypeScript 写作智能体
│   ├── src/main.ts             JSON 行 RPC 入口
│   ├── src/project-agent.ts    项目 Agent 变更规划与委托
│   ├── src/graphs/             章节写作工作流
│   ├── src/context/            上下文裁剪与持久缓存
│   ├── src/models/             OpenAI/Anthropic 模型协议
│   ├── src/storage/            SQLite、FTS5 和可选向量检索
│   └── src/streaming/          Agent 进度事件
├── src/                        技能管理、拆书分析和书源基础模块
├── schema/                     数据结构参考
├── scripts/                    构建与发布脚本
└── docs/                       专题文档与截图
```

## 平台运行方式

### 桌面端

React 通过 Tauri command 调用 `desktop-app/src-tauri/src/lib.rs`。Rust 层负责：

- 启动 `sidecars/agent-runtime/dist/main.js` Node 子进程。
- 使用 stdin/stdout 发送 JSON 行 RPC，并把流式事件转发给前端。
- 保存本地小说数据、导入导出、备份恢复和系统文件操作。

Agent Runtime 负责模型请求、上下文整理、章节写作、记忆生成、项目 Agent 和书源处理。

### Android 与 iOS

移动端不启动 Node 子进程。`desktop-app/src/platform.ts` 使用同一组前端调用名，在 Tauri 原生 HTTP 通道上直接实现模型请求和必要业务逻辑：

- OpenAI Chat Completions 兼容协议。
- Anthropic Messages 协议。
- SSE 流式正文和本机 token 统计。
- 本地项目与备份仍由 Tauri 数据层管理。

移动端构建要求见 [desktop-app/MOBILE.md](desktop-app/MOBILE.md)。

## 模型协议

设置档案决定实际 wire mode：

| 模式 | 对话端点 | 认证 |
| --- | --- | --- |
| OpenAI 兼容 | `/v1/chat/completions` | `Authorization: Bearer` |
| Anthropic Messages | `/v1/messages` | `x-api-key` + `anthropic-version` |

两种模式都支持模型列表、配置诊断和流式输出。上下文设置以 Token 为单位，发送前会为最大输出预留空间并按 tokenizer 裁剪输入；Anthropic 还会通过 `/v1/messages/count_tokens` 进行服务端校准。OpenAI 兼容的私有模型若不公开 tokenizer，则按其兼容模型族编码，最终用量以上游响应中的 usage 为准。Anthropic 的 system、thinking block、`text_delta` 与 usage 结构会在传输层转换，避免推理内容进入章节正文。

## 写作与项目 Agent

章节写作由 `chapter.write` RPC 进入 Agent Runtime，主要流程为：

1. 裁剪并缓存项目资料。
2. 检索最近章节、记忆、卡片和知识图谱。
3. 根据章纲和作者指令生成正文。
4. 审查并按需修订。
5. 返回正文、摘要和流式进度事件。

项目 Agent 使用“先生成待确认变更，再由用户应用”的方式工作。当前支持小说资料、大纲、卡片、记忆文档、图谱和新章节草稿；不支持直接修订已有章节，详见 `TODO.md`。

## 本地数据

小说项目、章节、大纲、卡片、记忆文档和图谱存放在应用数据目录。桌面端还支持：

- 完整备份与恢复。
- GitHub 小说仓库同步。
- 百度网盘同步。
- StoryForge 目录导入。

API Key、个人作品和备份不应进入 Git 仓库。

## 验证命令

```bash
npm test
npm run typecheck
npm --prefix sidecars/agent-runtime run build
npm --prefix desktop-app run build
```

桌面严格类型检查需运行 `cd desktop-app && npx tsc -b`；其存量错误记录在 [TODO.md](TODO.md)。
