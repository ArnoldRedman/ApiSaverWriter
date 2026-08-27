# TODO

本次改动（自定义 API 接入 + Anthropic Messages 协议 + 配置档案切换 + 配置检测）已完成并通过
单元测试与真机验证，以下是**尚未做完或未验证**的部分。

## 未验证（缺真实凭据）

- [ ] **Anthropic Messages 真机联调**：协议实现有 13 个单元测试覆盖（地址归一化、`x-api-key`
      认证、system 提升、thinking 预算、SSE `text_delta`/`thinking_delta` 区分、usage 累加），
      但没有可用的 Anthropic Key，未跑过一次真实的 `/v1/messages` 请求。
      拿到 Key 后在设置里点「检测配置」即可端到端验证。
- [ ] **`reasoning_effort` 字段兼容性**：原实现发的是 Responses API 的 `reasoning: { effort }`，
      已改成 Chat Completions 文档里的 `reasoning_effort`。已在 tokenfreeperday 中转站上确认
      请求能发出，但没有确认该站是否真的按 effort 生效。若某中转站因此报 400，
      `chat()` 里的 503 兼容重试会剥掉该字段，但 400 不会 —— 需要时把 400 也纳入剥离重试。
- [ ] **思考强度 `max`**：OpenAI 兼容接口没有 `max` 档，会按 `high` 发送（UI 已提示）。
      仅 Anthropic 模式下 `max` 才是独立的 24K thinking 预算。

## 已知限制

- [ ] **Embedding 只支持 OpenAI 格式**：`sidecars/agent-runtime/src/embedding/embedding-provider.ts`
      只有 `/v1/embeddings` 实现（Anthropic 无此端点）。目前该 Provider 在 `src/` 里
      没有任何调用点，所以不影响运行；一旦接入向量检索，Anthropic 档案需要单独指定
      一个 OpenAI 兼容的 embedding 地址。
- [ ] **上下文窗口单位是「字符」不是 token**：`limitMessagesToKB` 按 `KB × 1024` 个字符做截断
      预算，UI 上的 1M / 2M 指字符数。中文场景下 1 字符 ≈ 1 token 量级，够用，但和模型标称的
      token 窗口不是同一个量。若要严格对齐，需要引入 tokenizer。
- [ ] **中转站用量面板仅对 ApiSaver 官方地址可用**：其余地址（含 Anthropic）走本机 Token 统计
      回退，已由 `isDefaultApiService` 正确门控。若需要给其它中转站做余额查询，得按站点适配。

## 工程债（存量，非本次引入）

- [ ] **`npm run build` 实际不做类型检查**：根 `tsconfig.json` 是 solution 风格
      （`files: []` + `references`），不带 `-b` 的 `tsc` 对它什么都不检查 —— 这就是那个
      TDZ 黑屏 bug 能构建通过的原因。
      当前 `npx tsc -b` 有 **41 个存量错误**（未使用变量、setState 类型协变、用量日志行类型），
      其中**没有**会导致运行时崩溃的一类（TS2448/2454/2304 已清零）。
      建议：先加 `"typecheck": "tsc -b"` 脚本，把 41 个清干净后再接进 CI 和 `build`，
      现在直接改 `build` 会让构建立刻失败。
- [ ] **`src/embedding/__tests__/embedding.test.ts` 失败**：`beforeEach` 里下载
      `@xenova/transformers` 模型超时（30s）。属存量问题，`npm test` 因此整体非零退出；
      `tests/` 目录下 8 个文件 45 个测试全部通过。

## 小说目录导入

- [ ] **`desktop-app/scripts/import-story-folder.mjs` 只适配 StoryForge 目录结构**
      （`story_data/{chapters,outlines,bible,state}`）。换别的目录布局需要改映射。
- [ ] **知识图谱与章节记忆留空**：这两块是 AI 生成产物，导入时没有凭空构造。
      在应用里跑一次章节智能体即可开始积累。
- [ ] 脚本有防覆盖保护：`projects/` 非空时直接中止。要重新导入需先在应用里删掉这本书，
      或用 `--app-data` 指向空目录先验证。









不是执行权限不足，而是当前应用的变更协议没有“修改既有章节正文”这一类操作。可提交的七种变更中，chapter.draft_next 只允许起草下一章，不能用于覆盖或修订第152、157、158、159章；outline.write 和 card.write 也不能冒充章节修改。索引虽然提供了章节编号和正文资料，但没有对应的 chapter.update、chapter.revise 或 chapter.patch 类型，因此我如果强行提交，只能产生无效变更，不能声称已经保存。若要支持本需求，应用代码需要新增一个专门的既有章节修订变更类型，例如 chapter.revise，至少包含 targetId（真实章节ID）、summary、instruction，或包含由章节智能体生成的 replacement/operations；后端还需实现权限校验、版本并发控制、保存及回滚。前端执行模式和变更白名单、API schema、服务端 dispatcher、数据库写入逻辑以及确认后的回调都要同步支持。当前协议下我只能定位问题并提出修改要求，不能实际删除既有章节中的成语串。
