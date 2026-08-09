import { describe, expect, it } from "vitest";
import { StoryStore } from "../src/storage/story-store.js";

describe("StoryStore", () => {
  it("stores confirmed memory and retrieves it through FTS5 inside the same project", () => {
    const store = StoryStore.inMemory();
    store.createProject({ id: "tide", title: "潮汐以北" });
    store.createProject({ id: "other", title: "另一部小说" });

    store.saveMemory({
      id: "m-1",
      projectId: "tide",
      type: "event",
      title: "旧电台录音",
      content: "沈砚在旧电台听到了母亲留下的录音。",
      entityNames: ["沈砚", "母亲", "旧电台"],
      confirmed: true,
      importance: 0.9,
    });
    store.saveMemory({
      id: "m-2",
      projectId: "other",
      type: "event",
      title: "无关内容",
      content: "另一部小说也提到录音。",
      entityNames: [],
      confirmed: true,
      importance: 0.5,
    });

    expect(store.searchExact("tide", "录音")).toEqual([
      expect.objectContaining({ id: "m-1", projectId: "tide" }),
    ]);
  });

  it("does not retrieve unconfirmed AI-extracted facts as canonical memory", () => {
    const store = StoryStore.inMemory();
    store.createProject({ id: "tide", title: "潮汐以北" });
    store.saveMemory({
      id: "candidate",
      projectId: "tide",
      type: "canon_fact",
      title: "待确认事实",
      content: "沈砚的父亲已经死亡。",
      entityNames: ["沈砚"],
      confirmed: false,
      importance: 1,
    });

    expect(store.searchExact("tide", "父亲")).toEqual([]);
  });
});
