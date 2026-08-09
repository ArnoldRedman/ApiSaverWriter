import { describe, expect, it } from "vitest";
import { byteLength, compactKnowledgeGraph, compactText, LruCache, prepareChapterInput, stableHash } from "../src/context/context-optimizer.js";

describe("context optimizer", () => {
  it("keeps both ends of oversized chapter material", () => {
    const source = `开场事实${"中".repeat(200)}章末钩子`;
    const result = compactText(source, 120);
    expect(byteLength(result)).toBeLessThanOrEqual(120);
    expect(result).toContain("开场事实");
    expect(result).toContain("章末钩子");
  });

  it("packs only a relevant graph neighborhood", () => {
    const result = compactKnowledgeGraph({
      nodes: [
        { id: "a", label: "沈砚", type: "entity" },
        { id: "b", label: "旧电台", type: "entity" },
        { id: "c", label: "无关地点", type: "entity" },
      ],
      edges: [{ source: "a", target: "b", label: "发现" }, { source: "b", target: "c", label: "远处" }],
    }, "沈砚在旧电台前停下", 800);
    expect(result).toContain("沈砚");
    expect(result).toContain("旧电台");
    expect(byteLength(result)).toBeLessThanOrEqual(800);
  });

  it("uses deterministic hashes and reports source pruning", () => {
    const input = {
      instruction: "继续写沈砚发现旧电台",
      outlines: [{ id: 1, kind: "细纲", title: "第一章", content: "沈砚回到海边老家" }],
      cards: [{ title: "沈砚", type: "角色卡", content: "性格敏感" }],
      knowledgeGraph: { nodes: [{ id: "a", label: "沈砚", type: "entity" }], edges: [] },
      skills: [{ name: "story-long-write", category: "write", description: "续写", tags: ["章节"], content: "保持视角" }],
      contextWindowKB: 16,
    };
    const first = prepareChapterInput(input);
    const second = prepareChapterInput({ ...input, outlines: [...input.outlines] });
    expect(stableHash(input)).toBe(stableHash({ ...input }));
    expect(first.report.sourceBytes).toBeGreaterThanOrEqual(first.report.packedBytes);
    expect(first.outline).toContain("海边老家");
    expect(second.report.sections).toEqual(first.report.sections);
  });

  it("evicts the least recently used entry", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
  });
});
