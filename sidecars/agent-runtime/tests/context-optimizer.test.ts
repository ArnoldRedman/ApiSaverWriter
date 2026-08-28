import { describe, expect, it } from "vitest";
import { byteLength, compactKnowledgeGraph, compactText, LruCache, normalizePromptWhitespace, prepareChapterInput, stableHash } from "../src/context/context-optimizer.js";

describe("context optimizer", () => {
  it("keeps both ends of oversized chapter material", () => {
    const source = `开场事实${"中".repeat(200)}章末钩子`;
    const result = compactText(source, 120);
    expect(byteLength(result)).toBeLessThanOrEqual(120);
    expect(result).toContain("开场事实");
    expect(result).toContain("章末钩子");
  });

  it("normalizes token-wasting document whitespace without changing Markdown structure", () => {
    const source = "  # 标题  \r\n\r\n\r\n段落   之间   空格\n\n```txt\n  保留   代码缩进  \n```\n";
    expect(normalizePromptWhitespace(source)).toBe("# 标题\n\n段落 之间 空格\n\n```txt\n  保留   代码缩进\n```");
    expect(compactText(source, 500)).not.toContain("\r");
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

  it("puts stronger graph relationships ahead of weaker ones in the chapter context", () => {
    const result = compactKnowledgeGraph({
      nodes: [
        { id: "a", label: "沈砚", type: "entity" },
        { id: "b", label: "锁匙", type: "card" },
        { id: "c", label: "旧传闻", type: "entity" },
      ],
      edges: [
        { source: "a", target: "c", label: "听说", weight: 0.2 },
        { source: "a", target: "b", label: "持有", weight: 0.95 },
      ],
    }, "沈砚准备使用锁匙", 800);
    expect(result).toContain("权重 0.95");
    expect(result.indexOf("持有")).toBeLessThan(result.indexOf("听说"));
  });

  it("uses deterministic hashes and reports source pruning", () => {
    const input = {
      instruction: "继续写沈砚发现旧电台",
      outlines: [{ id: 1, kind: "细纲", title: "第一章", content: "沈砚回到海边老家" }],
      cards: [{ title: "沈砚", type: "角色卡", content: "性格敏感" }],
      knowledgeGraph: { nodes: [{ id: "a", label: "沈砚", type: "entity" }], edges: [] },
      skills: [{ name: "story-long-write", category: "write", description: "续写", tags: ["章节"], content: "保持视角" }],
      contextWindowKTokens: 16,
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
