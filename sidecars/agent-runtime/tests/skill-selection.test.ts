import { describe, expect, it } from "vitest";
import { selectSkillsByIntent } from "../src/graphs/chapter-write.graph.js";

describe("chapter skill intent selection", () => {
  const catalog = [
    { name: "story-long-write", category: "write", description: "长篇章节续写", tags: ["章节", "正文"], content: "write" },
    { name: "story-review", category: "review", description: "一致性审查", tags: ["审查", "逻辑"], content: "review" },
    { name: "story-deslop", category: "polish", description: "去 AI 味润色", tags: ["润色"], content: "polish" },
  ];

  it("selects review skills from an author's intent", () => {
    const result = selectSkillsByIntent("请检查本章逻辑和人物状态是否一致", catalog);
    expect(result.intent).toContain("审查");
    expect(result.skills.map(skill => skill.name)).toContain("story-review");
  });

  it("falls back to long-form writing when intent is implicit", () => {
    const result = selectSkillsByIntent("继续写下一章，结尾留下悬念", catalog);
    expect(result.skills[0]?.name).toBe("story-long-write");
  });
});
