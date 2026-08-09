import { describe, it, expect, beforeEach } from "vitest";
import { StoryStore } from "../../storage/story-store.js";
import { LocalEmbeddingProvider } from "../embedding-provider.js";

describe("Embedding and Vector Search", () => {
  let store: StoryStore;
  const projectId = "test-embedding-project";

  beforeEach(async () => {
    store = StoryStore.inMemory();
    store.createProject({ id: projectId, title: "向量检索测试项目" });

    // 启用向量检索（使用本地轻量级模型）
    const embeddingProvider = new LocalEmbeddingProvider();
    store.enableVectorSearch(embeddingProvider);

    // 插入测试数据
    const memories = [
      {
        id: "mem-1",
        projectId,
        type: "event" as const,
        title: "沈砚发现录音",
        content: "沈砚在旧电台的抽屉里发现了母亲留下的录音带，录音中提到了一座退潮后才会出现的小岛。",
        entityNames: ["沈砚", "母亲", "录音", "小岛"],
        confirmed: true,
        importance: 0.9,
      },
      {
        id: "mem-2",
        projectId,
        type: "character_state" as const,
        title: "沈砚的决心",
        content: "沈砚决定出海寻找那座神秘的小岛，尽管他知道这可能是一次有去无回的冒险。",
        entityNames: ["沈砚", "小岛"],
        confirmed: true,
        importance: 0.8,
      },
      {
        id: "mem-3",
        projectId,
        type: "canon_fact" as const,
        title: "电台的历史",
        content: "这座电台建于1950年代，曾是海岸警备队的通讯站，在一次台风后被废弃。",
        entityNames: ["电台", "海岸警备队"],
        confirmed: true,
        importance: 0.6,
      },
    ];

    for (const mem of memories) {
      store.saveMemory(mem);
      // 为每个记忆生成向量
      await store.saveMemoryVector(mem.id, mem.content);
    }
  }, 30000); // 增加超时到 30 秒，首次下载模型需要时间

  it("应该能够进行语义向量检索", async () => {
    // 查询：主角为何决定出海？
    // 这个查询没有直接包含"沈砚"或"出海"，但语义上相关
    const results = await store.searchSemantic(
      projectId,
      "主角第一次发现父亲失踪线索的地方",
      3
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].similarity).toBeGreaterThan(0);
    
    // 应该包含相关的记忆（可能是 mem-1 或 mem-2）
    const ids = results.map(r => r.id);
    expect(ids).toContain("mem-1"); // 包含发现录音的事件
  }, 15000);

  it("应该能够进行混合检索（FTS5 + 向量）", async () => {
    // 精确关键词：沈砚 + 录音
    const results = await store.searchHybrid(projectId, "沈砚 录音", 5);

    expect(results.length).toBeGreaterThan(0);
    
    // 应该包含相似度信息
    expect(results[0]).toHaveProperty("similarity");
    
    // FTS5 应该能精确匹配到 mem-1
    const exactMatch = results.find(r => r.id === "mem-1");
    expect(exactMatch).toBeDefined();
    expect(exactMatch!.title).toBe("沈砚发现录音");
  }, 15000);

  it("向量检索未启用时应降级到 FTS5", () => {
    // 创建一个没有启用向量检索的 store
    const store2 = StoryStore.inMemory();
    store2.createProject({ id: projectId, title: "仅 FTS5 测试" });

    store2.saveMemory({
      id: "mem-fts",
      projectId,
      type: "event",
      title: "测试事件",
      content: "沈砚在海边散步",
      entityNames: ["沈砚"],
      confirmed: true,
      importance: 0.5,
    });

    // 应该只使用 FTS5
    const results = store2.searchExact(projectId, "沈砚", 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("mem-fts");
  });

  it("应该正确计算余弦相似度", async () => {
    const results = await store.searchSemantic(projectId, "录音带", 3);

    // 所有相似度应该在 [0, 1] 范围内
    for (const result of results) {
      expect(result.similarity).toBeGreaterThanOrEqual(0);
      expect(result.similarity).toBeLessThanOrEqual(1);
    }

    // 结果应该按相似度降序排列
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
    }
  });

  it("混合检索应该合并并去重 FTS5 和向量结果", async () => {
    const results = await store.searchHybrid(projectId, "沈砚 小岛", 10);

    // 不应有重复的 ID
    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);

    // 应该包含 mem-1 和 mem-2（都提到小岛）
    const ids_set = new Set(ids);
    expect(ids_set.has("mem-1")).toBe(true);
    expect(ids_set.has("mem-2")).toBe(true);
  });
});
