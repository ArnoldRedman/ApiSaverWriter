import { describe, it, expect } from "vitest";
import { StoryStore } from "../src/storage/story-store.js";

describe("FTS5 Debug", () => {
  it("should index and search Chinese text", () => {
    const store = StoryStore.inMemory();
    store.createProject({ id: "test", title: "测试" });
    
    // 插入记忆
    store.saveMemory({
      id: "mem-1",
      projectId: "test",
      type: "character_state",
      title: "主角沈砚",
      content: "沈砚是一位23岁的无业青年，最近搬回海边老家。",
      entityNames: ["沈砚"],
      confirmed: true,
      importance: 0.9,
    });

    // 验证 memory_items 表
    const allMemories = store.listConfirmed("test", 100);
    console.log("Memory items count:", allMemories.length);
    console.log("Memory content:", allMemories[0]?.content);

    // 尝试搜索
    const results = store.searchExact("test", "沈砚", 5);
    console.log("Search results count:", results.length);
    if (results.length > 0) {
      console.log("First result:", results[0]);
    }

    expect(results.length).toBeGreaterThan(0);
  });
});
