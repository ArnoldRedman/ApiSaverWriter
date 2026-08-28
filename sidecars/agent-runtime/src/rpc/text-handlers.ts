import { createModelClient } from "../application/model-client.js";
import type { RpcRegistry } from "./registry.js";

const textModes = new Set(["polish", "de-ai", "continue", "revise"]);

export const registerTextHandlers = (registry: RpcRegistry): RpcRegistry => registry
  .register("text.transform", async params => {
    const { mode, instruction, content, previousChapter, maxWords, projectTitle, chapterTitle } = params;
    if (!content && !previousChapter) throw new Error("缺少文本处理所需参数");
    if (typeof mode !== "string" || !textModes.has(mode)) throw new Error("不支持的文本处理类型");
    const client = createModelClient(params, { model: "gpt-4o-mini" });
    const extraRequirement = String(instruction || "").trim();
    const numericLimit = Math.max(1, Math.floor(Number(maxWords) || 0));
    const prompt = mode === "polish"
      ? `你是小说文字编辑。请润色以下《${String(projectTitle || "未命名小说")}》${String(chapterTitle || "当前章节")}中的文本。\n\n要求：保持原意、人物口吻、叙述视角和情节事实不变；优化表达、动作逻辑、可读性和画面感；不要新增剧情，不要解释，不要加标题或 Markdown 标记。${extraRequirement ? `\n作者额外要求：${extraRequirement}` : ""}\n\n待润色文本：\n${String(content)}`
      : mode === "revise"
        // 修订与润色的关键区别：允许按作者指令改动情节和结构，但仍禁止自己发明设定
        ? `你是中文长篇网文作者。请根据作者指令修订《${String(projectTitle || "未命名小说")}》${String(chapterTitle || "当前章节")}的整章正文。\n\n作者修订指令：${extraRequirement || "提升可读性和冲突强度，保留原有事实"}\n\n要求：按指令改动，指令没有要求的部分保持原样；不得新增与原文矛盾的人物、设定或事件；不得改写本章之外的剧情；保持叙述视角和时间线连贯；只输出完整的修订后正文，不要输出修改说明、对比、标题或 Markdown 标记。\n\n待修订正文：\n${String(content)}`
      : mode === "de-ai"
        ? `你是小说文字编辑。请为以下《${String(projectTitle || "未命名小说")}》${String(chapterTitle || "当前章节")}的文本去除机械化 AI 写作痕迹。\n\n要求：保持原意、人物、叙述视角、事实、情节与既有文风不变；拆除模板化套话、均匀句式、总结腔和机械因果衔接；优先使用准确的动作、感官细节与角色化表达；不要新增剧情、设定、人物或信息，不要解释，不加标题或 Markdown 标记。${extraRequirement ? `\n作者额外要求：${extraRequirement}` : ""}\n\n待改写文本：\n${String(content)}`
      : `你是长篇网络小说作者。请为《${String(projectTitle || "未命名小说")}》的${String(chapterTitle || "当前章节")}续写一段可直接插入正文的内容。\n\n要求：只输出续写正文，不复述已有内容，不加标题、注释或 Markdown 标记；承接已有的叙事视角、人物状态、时间线和文风；推进一个明确动作或事件，并自然收束在可继续写作的位置；输出不得超过 ${numericLimit} 个非空白字符。${extraRequirement ? `\n作者续写要求：${extraRequirement}` : ""}\n\n上一章结尾（仅在当前章为空时优先承接）：\n${String(previousChapter || "无")}\n\n当前章节已有内容：\n${String(content || "（当前章为空，请承接上一章）")}`;
    const response = await client.chat([{ role: "user", content: prompt }], {
      temperature: mode === "continue" ? 0.75 : mode === "de-ai" ? 0.45 : mode === "revise" ? 0.6 : 0.35,
      // 修订输出是整章正文，不能用润色的 5000 上限截掉结尾
      max_tokens: mode === "continue" ? Math.min(7000, Math.max(500, Math.ceil(numericLimit * 1.6))) : mode === "revise" ? 12_000 : 5000,
      retryAttempts: 2,
    });
    let result = response.content.trim().replace(/^```(?:markdown|text)?\s*/i, "").replace(/```$/u, "").trim();
    if (mode === "continue" && numericLimit > 0 && Array.from(result.replace(/\s/gu, "")).length > numericLimit) {
      const limited = Array.from(result).slice(0, numericLimit).join("");
      const ending = Math.max(limited.lastIndexOf("。"), limited.lastIndexOf("！"), limited.lastIndexOf("？"));
      result = (ending > numericLimit * 0.55 ? limited.slice(0, ending + 1) : limited).trim();
    }
    return { content: result };
  });
