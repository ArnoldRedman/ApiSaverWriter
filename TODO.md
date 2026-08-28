# TODO

本清单已按当前代码和本地验证结果重新核对。勾选项表示已经实现并验证；未勾选项表示仍需开发或缺少真实环境验证。

## 待完成或待验证

- [ ] **Anthropic Messages 真机联调**
  - 桌面 Runtime 和移动端均已实现 `/v1/messages`、`x-api-key`、system 提升、thinking 预算、SSE 文本过滤与 usage 累加。
  - 自动化测试已覆盖协议行为，但当前没有真实 Anthropic Key，尚未完成官方接口端到端验证。
  - 有 Key 后可在设置中点击「检测配置」验证模型列表和实际调用。

- [ ] **确认 `reasoning_effort` 在目标中转站真实生效**
  - OpenAI Chat Completions 请求已发送 `reasoning_effort`，`max` 会降级为 `high`。
  - 503 兼容重试会移除该字段；400 当前不会触发兼容重试。
  - 只有目标中转站出现 400，或确认忽略该字段时，再扩展重试规则。

- [ ] **批量变更的整轮预算上限**
  - 单个 fetch 已有超时，但一次 `project.agent.chat` 仍可串行跑多个委派，没有整轮上限。
  - 修订已硬限 3 章，`chapter.draft_next` 仍可达 16 项；需要时再加统一的时间或数量预算。

- [ ] **扩展小说目录导入格式**
  - `desktop-app/scripts/import-story-folder.mjs` 仍只适配 StoryForge 的 `story_data/{chapters,outlines,bible,state}` 结构。
  - 如需导入其他目录布局，再按真实样本增加映射，不预先设计通用导入框架。

- [ ] **导入已有章节记忆**
  - 导入脚本会生成设定事实记忆文档和知识图谱，但 `memories` 仍为空。
  - 若源目录以后提供可靠的逐章摘要，可再导入；当前可在应用中运行章节智能体生成。

## 已完成

- [x] **项目 Agent 可以修订和删除既有章节**
  - 变更协议新增 `chapter.revise`（规划意图）、`chapter.update`（落地结果）和 `chapter.delete`。
  - 修订委派给 `text.transform` 的 `revise` 模式，模型不能自己往 changes 里写正文。
  - 单轮修订硬限 3 章，超出部分以 toolEvent 如实告知而不静默丢弃。
  - 章节删除的级联清理收敛到 `domain/chapter.ts`，UI 删除和 Agent 删除共用同一份逻辑。

- [x] **自定义 API、Anthropic Messages、配置档案与配置检测**
  - 桌面 Runtime 和移动端均有 OpenAI/Anthropic 两套传输实现。
  - 设置页支持地址、认证、模型列表和实际对话诊断。

- [x] **思考强度 `max` 的协议映射**
  - OpenAI 兼容接口按 `high` 发送；Anthropic 使用 24K thinking budget；UI 已提示差异。

- [x] **Embedding 测试恢复**
  - `src/embedding/__tests__/embedding.test.ts` 的 5 个测试现已通过，不再导致 `npm test` 失败。

- [x] **导入知识图谱与设定事实文档**
  - StoryForge 导入脚本会从角色、地点和关系状态生成图谱节点、边与设定事实文档。

- [x] **导入防覆盖保护**
  - 本地 `projects/` 非空时脚本会中止；可使用 `--dry-run` 或空的 `--app-data` 先验证。

- [x] **架构重构阶段 0/1：质量门禁与共享契约**
  - 新增 `packages/contracts`，统一 RPC 方法表、DTO、进度事件和运行时参数校验。
  - 前端 Agent 调用统一经过 typed `agentRpcAs()`；Runtime 通过 `RpcRegistry` 注册和校验。
  - 清理桌面严格 TypeScript 存量错误，构建改为 `tsc -b`；CI 打包前强制执行 `npm run check`。

- [x] **第一批物理模块拆分**
  - Runtime 书源、榜单、模型、内容和文本处理拆入 `sources/`、`application/`、`rpc/`。
  - 移动百度同步和书源拆入 `platform/mobile/`；Rust Agent 进程桥拆入 `runtime.rs`。
  - 前端 Project、Library、Skill、KnowledgeGraph、模型设置和项目 Agent 会话模型拆入 `domain/` 与 `features/`。
  - `projects` 成为唯一项目状态源，编辑器只保存项目 ID；章节/大纲/卡片流式输出按动画帧批量提交。
  - Rust project_store、resource_store、runtime 已独立；删除不在 workspace、构建或应用链路中的旧根 `src/`/`tests/` 原型。

## 架构后续阶段

- [ ] **继续收敛前端组合根**
  - 按 projects/editor/agent/library/rankings/settings/sync 继续拆分 hooks 与页面组件。
  - `projects` 已成为唯一项目状态源，编辑区只保存 projectId；后续继续拆章节选择与页面渲染。

- [ ] **项目增量持久化**
  - 新增细粒度保存命令，避免每次小编辑序列化并重写整个项目数组。
  - 保持现有本地文件格式，先补往返与失败恢复测试再迁移。

- [ ] **继续拆分 Rust 原生模块**
  - project_store、resource_store 和 runtime 已拆出；后续继续拆 agent_chat_store、backup/github、backup/baidu、system。
  - `lib.rs` 最终只保留插件、状态和 command 注册。

- [x] **统一核心模型协议纯逻辑**
  - 新增 `packages/model-protocol`，共享认证、Anthropic 消息转换、thinking/reasoning 档位和正文块过滤。
  - 平台层保留 fetch/进程/文件 IO；地址、usage 和完整请求 body 的剩余重复在后续按测试迁移。

## 已知限制

这些是当前明确边界，不等同于未完成任务；只有真实需求出现时再升级。

- **Embedding 只支持 OpenAI 兼容 `/v1/embeddings`**：生产流程当前没有启用 Embedding Provider；Anthropic 档案若以后接入向量检索，需要单独配置 OpenAI 兼容的 embedding 服务。
- **自定义私有模型的 tokenizer 取决于兼容协议**：OpenAI 兼容模型默认使用 `o200k_base`（旧 GPT-4/3.5 使用 `cl100k_base`）；Anthropic 会再调用 `/v1/messages/count_tokens` 校准。若私有中转模型使用未公开的不同 tokenizer，只能以上游最终 usage 为账单真值。
- **中转站余额面板只支持 ApiSaver 官方地址**：其他地址使用本机 token 统计，不查询第三方余额和日志。

## 本轮验证

```text
npm test                                      通过：Runtime 13 个文件 75 个测试，桌面 2 个测试
npm run typecheck                             通过：Contracts + Model Protocol + Agent Runtime
npm --prefix sidecars/agent-runtime run build 通过
npm --prefix desktop-app run lint             通过：0 警告
npm --prefix desktop-app run test             通过：章节删除级联清理
npm --prefix desktop-app run build            通过：严格 tsc -b + Vite（有 chunk 大小警告）
npm run check:rust                            通过
npm run test:rust                             通过
```
