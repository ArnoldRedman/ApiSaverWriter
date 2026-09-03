import { describe, expect, it, vi } from "vitest";
import { partsFromBreaks, planChapterBreaks, planChapterSplits, splitParagraphs } from "../src/application/chapter-split.js";
import { ModelApiClient } from "../src/models/model-api.js";

/** 造一段指定字数的正文，字数计算按“去掉空白后的字符数” */
const paragraph = (characters: number, mark = "字") => mark.repeat(characters);
const clientReturning = (bodies: string[]) => {
  const chat = vi.fn().mockImplementation(() => Promise.resolve({ content: bodies.shift() ?? "{}", model: "test" }));
  return { client: { chat } as unknown as ModelApiClient, chat };
};

describe("splitParagraphs", () => {
  it("按空行分段并吃掉 CRLF 和首尾空白", () => {
    expect(splitParagraphs("第一段。\r\n\r\n  第二段。  \n\n\n第三段。\n")).toEqual(["第一段。", "第二段。", "第三段。"]);
  });

  it("整章没有空行时只算一段", () => {
    expect(splitParagraphs("一整块正文\n换行但没有空行")).toEqual(["一整块正文\n换行但没有空行"]);
  });
});

describe("planChapterBreaks", () => {
  it("按目标字数在段落边界上断开", () => {
    const breaks = planChapterBreaks([paragraph(1500), paragraph(1500), paragraph(1500), paragraph(1500)], 2400);

    // 前两段累计 3000 字越过 2400，在第 2 段之后断；再累计到第 4 段结束
    expect(breaks).toEqual([2]);
    expect(partsFromBreaks([paragraph(1500), paragraph(1500), paragraph(1500), paragraph(1500)], breaks)).toHaveLength(2);
  });

  it("六千字的章节切成三段左右，每段都在目标字数附近", () => {
    const paragraphs = Array.from({ length: 12 }, () => paragraph(500));
    const breaks = planChapterBreaks(paragraphs, 2400);
    const parts = partsFromBreaks(paragraphs, breaks);

    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const part of parts) {
      expect(part.replace(/\s/gu, "").length).toBeGreaterThanOrEqual(400);
    }
    expect(parts.join("\n\n").replace(/\s/gu, "")).toBe(paragraphs.join("").replace(/\s/gu, ""));
  });

  it("没超过目标字数就不拆", () => {
    expect(planChapterBreaks([paragraph(1200), paragraph(1200)], 2400)).toEqual([]);
  });

  it("整章只有一段时无处可切", () => {
    expect(planChapterBreaks([paragraph(9000)], 2400)).toEqual([]);
  });

  it("尾巴太短就不再断，避免切出几十字的碎片章", () => {
    // 总字数已经越线，但切点之后只剩 100 字：宁可让它跟着上一段，也不单独成章
    expect(planChapterBreaks([paragraph(2000), paragraph(2000), paragraph(100)], 2400)).toEqual([]);
    // 尾巴够长就正常断开，证明上面拦下来的确实是「尾巴太短」这一条
    expect(planChapterBreaks([paragraph(2000), paragraph(2000), paragraph(900)], 2400)).toEqual([2]);
  });

  it("一章最多切成 12 段", () => {
    const breaks = planChapterBreaks(Array.from({ length: 60 }, () => paragraph(600)), 600);

    expect(breaks.length).toBe(11);
  });
});

describe("partsFromBreaks", () => {
  it("切点把段落原样分组，正文一个字都不改", () => {
    const paragraphs = ["A", "B", "C", "D", "E"];

    expect(partsFromBreaks(paragraphs, [2, 4])).toEqual(["A\n\nB", "C\n\nD", "E"]);
  });

  it("没有切点时整章原样返回", () => {
    expect(partsFromBreaks(["A", "B"], [])).toEqual(["A\n\nB"]);
  });
});

describe("planChapterSplits", () => {
  it("切点不问模型，只有新段落的标题才调用一次", async () => {
    const { client, chat } = clientReturning([JSON.stringify({ titles: [{ id: 1, title: "旧城残卷" }] })]);
    const result = await planChapterSplits(client, [
      { targetId: 151, title: "第 151 章 长夜", content: [paragraph(1600), paragraph(1600), paragraph(1600)].join("\n\n") },
    ], { targetWords: 2400 });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([]);
    expect(result.splits).toEqual([{ targetId: 151, paragraphCount: 3, breakAfter: [2], titles: ["第 151 章 长夜", "旧城残卷"] }]);
  });

  it("命名失败时退回序号名，拆分本身照常落地", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("网关 524"));
    const result = await planChapterSplits({ chat } as unknown as ModelApiClient, [
      { targetId: 151, title: "第 151 章 长夜", content: [paragraph(1600), paragraph(1600), paragraph(1600)].join("\n\n") },
    ], { targetWords: 2400 });

    expect(result.splits[0]?.titles).toEqual(["第 151 章 长夜", "长夜（2）"]);
  });

  it("不够长和没有分段的章节进 failures，不影响同批其他章节", async () => {
    const { client } = clientReturning([JSON.stringify({ titles: [{ id: 1, title: "旧城残卷" }] })]);
    const result = await planChapterSplits(client, [
      { targetId: 150, title: "第 150 章 短章", content: [paragraph(300), paragraph(300)].join("\n\n") },
      { targetId: 151, title: "第 151 章 长夜", content: [paragraph(1600), paragraph(1600), paragraph(1600)].join("\n\n") },
      { targetId: 152, title: "第 152 章 一整块", content: paragraph(9000) },
    ], { targetWords: 2400 });

    expect(result.splits.map(item => item.targetId)).toEqual([151]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toContain("第 150 章 短章");
    expect(result.failures[1]).toContain("整章没有分段");
  });

  it("标题数永远比切点多一个，第一段沿用原标题", async () => {
    const { client } = clientReturning([JSON.stringify({ titles: [] })]);
    const result = await planChapterSplits(client, [
      { targetId: 151, title: "第 151 章 长夜", content: Array.from({ length: 9 }, () => paragraph(800)).join("\n\n") },
    ], { targetWords: 2400 });

    const split = result.splits[0];
    expect(split?.titles).toHaveLength((split?.breakAfter.length ?? 0) + 1);
    expect(split?.titles[0]).toBe("第 151 章 长夜");
    expect(split?.breakAfter.every(entry => entry < (split?.paragraphCount ?? 0))).toBe(true);
  });
});
