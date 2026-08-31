import { afterEach, describe, expect, it, vi } from "vitest";
import { createChapterGraph } from "../src/graphs/chapter-write.graph.js";
import { StoryStore } from "../src/storage/story-store.js";

describe("chapter continuity context", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts the immediate previous chapter ending ahead of ordinary context", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      requests.push(body);
      const isReview = Array.isArray(body.messages)
        && JSON.stringify(body.messages).includes("待审查章节");
      const isPlan = Array.isArray(body.messages)
        && JSON.stringify(body.messages).includes("五段写作任务书");
      const content = isReview
        ? JSON.stringify({ consistent: true, issues: [], suggestions: [] })
        : isPlan
          ? JSON.stringify({ plan: JSON.stringify({ opening: "承接电台亮起与门外三声敲门。", story: "主角先确认门外来人身份，再寻找脱身线索。", ending: "门锁被人从外面轻轻拧动。" }), handoff: "门锁转动，主角仍在阁楼。" })
        : JSON.stringify({ content: "他握紧旧电台，门外又传来三声敲门。", summary: "主角承接电台线索并迎来新的危机。" });
      return new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const store = StoryStore.inMemory();
    store.createProject({ id: "continuity-project", title: "承接测试" });
    const graph = createChapterGraph({
      store,
      apiKey: "test-key",
      baseURL: "https://relay.test/v1",
      model: "test-model",
    });
    const result = await graph.invoke({
      projectId: "continuity-project",
      chapterId: "3",
      instruction: "继续写第三章，承接上一章结尾的危机",
      previousChapters: [{ id: "2", title: "第二章", content: "他推开阁楼门，旧电台突然亮起。章末钩子：门外响起三声敲门。" }],
      skillCatalog: [{
        name: "chapter-continuity",
        category: "write",
        description: "章节承接",
        tags: ["章节承接"],
        content: "先检查上一章结尾，再写本章第一段。",
      }, {
        name: "story-long-write",
        category: "write",
        description: "长篇续写",
        tags: ["续写"],
        content: "保持长篇节奏。",
      }],
    });

    expect(result.continuityContext).toContain("三声敲门");
    expect(requests[0]?.messages && JSON.stringify(requests[0].messages)).toContain("上一章结尾（最高优先级）");
    expect(requests[0]?.messages && JSON.stringify(requests[0].messages)).toContain("三声敲门");
    expect(result.selectedSkills).toContain("chapter-continuity");
    expect(result.chapterPlan).toBeTruthy();
    expect(result.chapterPlan).toContain("## 开篇承接");
    expect(result.chapterPlan).toContain("门锁转动");
    expect(result.chapterPlan).not.toContain('{"opening"');
    expect(requests[1]?.messages && JSON.stringify(requests[1].messages)).toContain("下一章计划");
    store.close();
  });
});
