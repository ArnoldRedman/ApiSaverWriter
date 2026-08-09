import { describe, expect, it } from "vitest";
import { StoryStore } from "../src/storage/story-store.js";

describe("StoryStore FTS5 debug", () => {
  it("shows what is actually indexed and what query is sent to FTS5", () => {
    const store = StoryStore.inMemory();
    store.createProject({ id: "test", title: "测试项目" });
    store.saveMemory({
      id: "m1",
      projectId: "test",
      type: "event",
      title: "旧电台录音",
      content: "沈砚在旧电台听到了母亲留下的录音。",
      entityNames: ["沈砚", "母亲", "旧电台"],
      confirmed: true,
      importance: 0.9,
    });

    // 直接查询 FTS 表内容
    const indexed = (store as any).db.prepare("SELECT * FROM memory_fts").all();
    console.log("Indexed in FTS5:", JSON.stringify(indexed, null, 2));

    // 测试不同查询
    const queries = ["录音", "录", "音", "沈砚", "电台"];
    for (const q of queries) {
      const result = store.searchExact("test", q);
      console.log(`Query "${q}" returned ${result.length} results`);
    }

    // 至少应能找到某个字
    expect(store.searchExact("test", "录").length + store.searchExact("test", "音").length).toBeGreaterThan(0);
  });
});
