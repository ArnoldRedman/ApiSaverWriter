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

- [ ] **支持项目 Agent 修订既有章节**
  - 当前变更协议只支持 `chapter.draft_next`，执行后生成 `chapter.create`，不能覆盖已有章节。
  - 需要新增类似 `chapter.revise` 的变更类型，并同步桌面/移动端白名单、Runtime schema、章节智能体委托、前端冲突快照和确认应用逻辑。

- [ ] **让桌面构建执行严格 TypeScript 检查**
  - `npm --prefix desktop-app run build` 当前能成功，但脚本中的 `tsc` 不会构建 solution references。
  - `cd desktop-app && npx tsc -b` 仍有存量类型错误；清理后应把 `tsc -b` 接入 `build` 或独立 CI 检查。
  - 根目录 `npm run typecheck` 目前只检查 Agent Runtime。

- [ ] **扩展小说目录导入格式**
  - `desktop-app/scripts/import-story-folder.mjs` 仍只适配 StoryForge 的 `story_data/{chapters,outlines,bible,state}` 结构。
  - 如需导入其他目录布局，再按真实样本增加映射，不预先设计通用导入框架。

- [ ] **导入已有章节记忆**
  - 导入脚本会生成设定事实记忆文档和知识图谱，但 `memories` 仍为空。
  - 若源目录以后提供可靠的逐章摘要，可再导入；当前可在应用中运行章节智能体生成。

## 已完成

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

## 已知限制

这些是当前明确边界，不等同于未完成任务；只有真实需求出现时再升级。

- **Embedding 只支持 OpenAI 兼容 `/v1/embeddings`**：生产流程当前没有启用 Embedding Provider；Anthropic 档案若以后接入向量检索，需要单独配置 OpenAI 兼容的 embedding 服务。
- **自定义私有模型的 tokenizer 取决于兼容协议**：OpenAI 兼容模型默认使用 `o200k_base`（旧 GPT-4/3.5 使用 `cl100k_base`）；Anthropic 会再调用 `/v1/messages/count_tokens` 校准。若私有中转模型使用未公开的不同 tokenizer，只能以上游最终 usage 为账单真值。
- **中转站余额面板只支持 ApiSaver 官方地址**：其他地址使用本机 token 统计，不查询第三方余额和日志。

## 本轮验证

```text
npm test                                      通过：11 个文件，62 个测试
npm run typecheck                             通过：Agent Runtime
npm --prefix sidecars/agent-runtime run build 通过
npm --prefix desktop-app run build            通过（有 chunk 大小警告）
cd desktop-app && npx tsc -b                  未通过：仍有存量类型错误
```
