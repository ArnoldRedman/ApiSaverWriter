import { describe, it, expect, beforeEach } from "vitest";
import { StoryStore } from "../src/storage/story-store.js";
import { createChapterGraph } from "../src/graphs/chapter-write.graph.js";

describe("End-to-End Chapter Generation", () => {
  let store: StoryStore;
  const testApiKey = process.env.API_SAVER_KEY || "test-key";

  beforeEach(() => {
    store = StoryStore.inMemory();
    store.createProject({ id: "test-novel", title: "测试小说" });
    
    // 添加测试记忆
    store.saveMemory({
      id: "mem-001",
      projectId: "test-novel",
      type: "character_state",
      title: "主角沈砚",
      content: "沈砚是一位23岁的无业青年，最近搬回海边老家。性格敏感、善于观察。",
      entityNames: ["沈砚"],
      confirmed: true,
      importance: 0.9,
    });

    store.saveMemory({
      id: "mem-002",
      projectId: "test-novel",
      type: "event",
      title: "发现旧电台",
      content: "沈砚在阁楼发现母亲留下的旧电台，电台中传出神秘的声音。",
      entityNames: ["沈砚", "电台"],
      confirmed: true,
      importance: 0.85,
    });
  });

  it("should retrieve relevant memories via FTS5", () => {
    // 直接使用 beforeEach 创建的 store，它已经有测试数据
    const results = store.searchExact("test-novel", "沈砚 电台", 5);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.content.includes("沈砚"))).toBe(true);
    expect(results.some(r => r.content.includes("电台"))).toBe(true);

    console.log("FTS5 search results:");
    results.forEach(r => {
      console.log(`  - ${r.title}: ${r.content.substring(0, 50)}...`);
    });
  });

  it("should generate a complete chapter with real API call", async () => {
    if (!process.env.API_SAVER_KEY) {
      console.warn("⚠️  Skipping E2E test: API_SAVER_KEY not set");
      return;
    }

    const graph = createChapterGraph({
      store: store,
      apiKey: testApiKey,
      model: "gpt-4o-mini",
    });

    const result = await graph.invoke({
      projectId: "test-novel",
      chapterId: "chapter-001",
      instruction: "写第一章：沈砚回到老家后，在阁楼发现母亲留下的旧电台。",
      outline: "1. 沈砚回到海边老家\n2. 整理阁楼时发现旧电台\n3. 电台突然响起",
    });

    // 验证检索结果
    expect(result.retrievedContext).toBeDefined();
    expect(result.retrievedContext.length).toBeGreaterThan(0);
    console.log("Retrieved context:", result.retrievedContext);

    // 验证生成的正文
    expect(result.draftContent).toBeDefined();
    expect(result.draftContent!.length).toBeGreaterThan(100);
    console.log("\n=== Generated Chapter ===");
    console.log(result.draftContent);

    // 验证摘要
    if (result.summary) {
      console.log("\n=== Chapter Summary ===");
      console.log(result.summary);
      expect(result.summary.length).toBeLessThan(500);
    }

    // 验证审查结果
    expect(result.reviewResult).toBeDefined();
    console.log("\n=== Review Result ===");
    console.log("Consistent:", result.reviewResult?.consistent);
    console.log("Issues:", result.reviewResult?.issues);
    console.log("Suggestions:", result.reviewResult?.suggestions);

    // 验证没有错误
    expect(result.errors).toHaveLength(0);
  }, 90000); // 90s timeout for real API calls with review
});
