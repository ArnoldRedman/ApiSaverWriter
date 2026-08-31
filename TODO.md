# TODO

本清单已按当前代码和本地验证结果重新核对。勾选项表示已经实现并验证；未勾选项表示仍需开发或缺少真实环境验证。

## 待完成或待验证

- [x] **项目Agent执行多章修订必报错**
  - 项目智能体执行多章任务，如查看150章到159章，修改每章的重复性结尾，他修改完一章就会报错，然后中断自己，同时上面的项目Agent1变成项目Agent2 
  - chapter.revise
    章节修订智能体失败：API 中转服务当前返回 504（可能来自代理或 API 上游网关），模型 gpt-5.6-sol · https://gt-token.zhuziplay.com/v1/chat/completions，已自动重试 1 次：openai_error
    chapter.revise
    章节修订智能体失败：API 中转服务当前返回 504（可能来自代理或 API 上游网关），模型 gpt-5.6-sol · https://gt-token.zhuziplay.com/v1/chat/completions，已自动重试 1 次：openai_error

- [x] **错误信息不再掩盖真实原因**
  - 旧 `upstreamErrorText` 只在响应体以 `{` / `[` 开头时解析，空响应体和 HTML 错误页被直接丢弃，401/403 退化成一句“请在设置中检查配置”，把排查方向带偏了两轮。
  - 新增 `describeErrorBody()`：JSON 取 message（无可读字段则回传压缩 JSON）、HTML 提取 `<title>` 并标明来自代理/CDN/WAF、纯文本截断 800 字符并注明省略量、空体单独标记。参考 `@earendil-works/pi-ai` 的 `utils/error-body.js`。
  - 401/403 补上模型名与实际 endpoint（与其他状态码一致）和请求体字节数；只在上游真的给出说明时才指向 Key，空体时改为列出网关/WAF 与权限两种可能。
  - 新增 `isContextOverflow()`：`request_too_large`、`prompt is too long`、413、以及空响应体的 400 归为超限，文案改成“降低思考强度 / 缩小上下文窗口”；频控文案里的 `too many tokens` 先排除，不误判为超限。参考 `utils/overflow.js`。
  - 新增 `ApiRequestError`（带 status）取代原来用 `message.startsWith("API ")` 区分致命/抖动的做法：文案一改就会错分类，把已读过响应体的请求拉回重试，报成 `Body is unusable`。

- [ ] **确认 `reasoning_effort` 在目标中转站真实生效**
  - OpenAI Chat Completions 请求已发送 `reasoning_effort`，`max` 会降级为 `high`。
  - 503 兼容重试会移除该字段；400 当前不会触发兼容重试。
  - 只有目标中转站出现 400，或确认忽略该字段时，再扩展重试规则。

- [x] **批量变更的整轮预算上限**
  - `REVISE_LIMIT` 从 3 章提到 10 章，系统提示词里的说明同步改写；作者处理 150 到 159 章这类连续段落时不必每三章重说一遍。
  - 委派阶段加 `DELEGATE_BUDGET_MS`（20 分钟）整轮墙钟预算：超预算的委派不再发请求，按条报出「未处理，请再说一次继续」，不静默丢弃。
  - 预算只拦委派。`memory.document.upsert`、图谱两项和 `chapter.delete` 不调模型，照常落地。
  - 预算可由 `delegateBudgetMs` 注入，`tests/project-agent.test.ts` 用 5ms 预算验证，不需要真的等 20 分钟。

- [ ] **扩展小说目录导入格式**
  - `desktop-app/scripts/import-story-folder.mjs` 仍只适配 StoryForge 的 `story_data/{chapters,outlines,bible,state}` 结构。
  - 如需导入其他目录布局，再按真实样本增加映射，不预先设计通用导入框架。

- [ ] **导入已有章节记忆**
  - 导入脚本会生成设定事实记忆文档和知识图谱，但 `memories` 仍为空。
  - 若源目录以后提供可靠的逐章摘要，可再导入；当前可在应用中运行章节智能体生成。

- [x] **具体的某一个小说的编辑页面难用**
  - 侧栏宽度和标签区高度改成行内 CSS 变量，两个手柄用 pointer capture 拖动，方向键也能调，结果写回 localStorage；窄屏和移动端隐藏手柄，标签区改横排。
  - 标签区加 `max-height` 与 `overflow-y: auto`：拖窄后自己滚动，不再固定占掉约 330px 高。
  - 章节排序、插入、定位、删除提到列表上方的操作条，只作用于当前选中章节，回收站入口并入同一行；列表项回到标题加字数两行，标题单行省略并挂 `title` 提示。
  - 字号 14/12 降到 12/10，条目间距收窄；删除桌面窄窗口写死的 230px / 205px 覆盖，交给用户拖动结果。
  - 尺寸夹取放在 `desktop-app/src/features/editor/layout.ts`，`layout.test.ts` 覆盖 localStorage 空值与越界值。