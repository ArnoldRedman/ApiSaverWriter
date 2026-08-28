import { createModelClient, stringList } from "../application/model-client.js";
import type { RpcRegistry } from "./registry.js";

/** 从模型返回里剥掉 ```json 围栏，失败时返回原始文本 */
const parseJsonContent = (content: string): Record<string, unknown> | null => {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/u, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const trimmed = (value: unknown, fallback = "") => typeof value === "string" ? value.trim() : fallback;

export const registerContentHandlers = (registry: RpcRegistry): RpcRegistry => registry
  .register("project.generate", async params => {
    const { field, source, title, synopsis, channel, tags, protagonist1, protagonist2, outlines, chapters } = params;
    if (field !== "title" && field !== "synopsis") throw new Error("缺少生成作品信息所需参数");
    const client = createModelClient(params, { model: "gpt-4o-mini" });
    const tagRecord = tags && typeof tags === "object" ? tags as Record<string, unknown> : {};
    const tagText = Object.entries(tagRecord).flatMap(([kind, values]) => stringList(values).map(value => `${kind}：${value}`)).join("；");
    const outlineContext = Array.isArray(outlines) && outlines.length
      ? outlines.map(item => {
        const outline = item as Record<string, unknown>;
        return `### ${String(outline.kind || "大纲")}｜${String(outline.title || "未命名")}\n${String(outline.content || "").slice(0, 5000)}`;
      }).join("\n\n")
      : "（暂无可用大纲，请根据已有作品信息构思）";
    const chapterContext = Array.isArray(chapters) && chapters.length
      ? chapters.map(item => {
        const chapter = item as Record<string, unknown>;
        return `### ${String(chapter.title || "章节")}\n${String(chapter.content || "").slice(0, 4500)}`;
      }).join("\n\n")
      : "（暂无可用章节，请根据已有作品信息构思）";
    const selectedContext = source === "chapters" ? chapterContext : outlineContext;
    const common = `频道：${String(channel || "男频")}\n标签：${tagText || "暂无"}\n主角：${[protagonist1, protagonist2].filter(Boolean).map(String).join("、") || "暂无"}\n当前书名：${String(title || "暂无")}\n已有作品简介：${String(synopsis || "暂无")}\n\n## ${source === "chapters" ? "前 3 章正文" : "作品大纲"}\n${selectedContext}`;
    const prompt = field === "title"
      ? `你是番茄小说平台的网文责编。请根据下列素材拟定一个适合${String(channel || "男频")}读者、具备题材卖点和记忆点的中文网文书名。\n\n${common}\n\n只返回 JSON：\n{ "title": "书名" }\n\n规则：书名 4 到 15 个汉字或常用数字；不要加《》、引号、作者名、解释、标点或副标题；避免与素材无关的套路词。`
      : `你是番茄小说平台的网文责编。请根据下列素材撰写可直接用于上架页的作品简介。\n\n${common}\n\n只返回 JSON：\n{ "synopsis": "作品简介" }\n\n规则：180 到 320 个中文字符，最多 500 字；开头迅速给出主角处境、核心金手指或矛盾，中段明确升级目标与风险，结尾留下强钩子；突出标签卖点和读者预期；不加标题、Markdown、分段序号、免责声明或解释；不得编造与素材矛盾的事实。`;
    const response = await client.chat([{ role: "user", content: prompt }], {
      response_format: { type: "json_object" },
      temperature: field === "title" ? 0.9 : 0.7,
      max_tokens: field === "title" ? 180 : 900,
      retryAttempts: 2,
    });
    const parsed = parseJsonContent(response.content);
    // 模型没有返回合法 JSON 时，把正文整体当作请求的那个字段
    if (!parsed) {
      const content = response.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/u, "").trim();
      return field === "title" ? { title: content } : { synopsis: content };
    }
    return { title: trimmed(parsed.title), synopsis: trimmed(parsed.synopsis) };
  })
  .register("skill.write", async params => {
    const { name, category, description, content, tags } = params;
    if (!name && !description && !content) throw new Error("缺少创建技能所需参数");
    const client = createModelClient(params, { model: "gpt-4o-mini" });
    const prompt = `你是 skill-creator。请把用户的小说写作需求整理成一个可复用技能。\n\n名称：${String(name || "待命名技能")}\n分类：${String(category || "write")}\n用途：${String(description || "暂无")}\n草稿：${String(content || "暂无")}\n标签：${stringList(tags).join("、") || "暂无"}\n\n只返回 JSON：\n{\n  "name": "短名称（英文 kebab-case）",\n  "category": "setup|write|review|polish|import|analyze|tool|creator",\n  "description": "一句话用途",\n  "tags": ["标签"],\n  "content": "Markdown 技能正文，包含触发条件、输入、步骤、输出格式、质量检查和失败处理"\n}\n不要输出 JSON 以外的文字。`;
    const response = await client.chat([{ role: "user", content: prompt }], { response_format: { type: "json_object" }, temperature: 0.3, max_tokens: 2200 });
    const parsed = parseJsonContent(response.content);
    if (!parsed) {
      return { name: String(name || "custom-skill"), category: String(category || "write"), description: String(description || ""), content: response.content, tags: stringList(tags, 12) };
    }
    return {
      name: trimmed(parsed.name, String(name || "custom-skill")),
      category: trimmed(parsed.category, String(category || "write")),
      description: trimmed(parsed.description, String(description || "")),
      content: trimmed(parsed.content, response.content),
      tags: stringList(parsed.tags, 12),
    };
  });
