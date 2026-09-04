import { describe, expect, it, vi } from "vitest";
import { partsFromBreaks, planBalancedBreaks, planChapterBreaks, planChapterSplits, splitParagraphs } from "../src/application/chapter-split.js";
import { ModelApiClient } from "../src/models/model-api.js";

/** 造一段指定字数的正文，字数计算按“去掉空白后的字符数” */
const paragraph = (characters: number, mark = "字") => mark.repeat(characters);
const clientReturning = (bodies: string[]) => {
  const chat = vi.fn().mockImplementation(() => Promise.resolve({ content: bodies.shift() ?? "{}", model: "test" }));
  return { client: { chat } as unknown as ModelApiClient, chat };
};
const sizes = (parts: string[]) => parts.map(item => item.replace(/\s/gu, "").length);

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
    const paragraphs = [paragraph(1500), paragraph(1500), paragraph(1500), paragraph(1500)];
    const breaks = planChapterBreaks(paragraphs, 2400);

    // 6000 字按 2400 一章算出 2 段（四舍五入），且均分成两段 3000
    expect(breaks).toEqual([2]);
    expect(sizes(partsFromBreaks(paragraphs, breaks))).toEqual([3000, 3000]);
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

  it("尾巴太短就少切一刀，不会切出几十字的碎片章", () => {
    // 4100 字按 2400 算出 2 段：切完之后只剩 100 字的那种切法被排除，改从中间切
    expect(planChapterBreaks([paragraph(2000), paragraph(2000), paragraph(100)], 2400)).toEqual([1]);
    // 段落本身就不够切（两段，其中一段只有 100 字）时整章不动
    expect(planChapterBreaks([paragraph(4000), paragraph(100)], 2400)).toEqual([]);
  });

  it("一章最多切成 12 段", () => {
    const breaks = planChapterBreaks(Array.from({ length: 60 }, () => paragraph(600)), 600);

    expect(breaks.length).toBe(11);
  });

  it("误差摊到每一段，不把它堆到最后一段", () => {
    // 贪心累加会给出 2400/2400/1200 这种尾巴，均分应该是三段 2000
    const paragraphs = Array.from({ length: 30 }, () => paragraph(200));
    expect(sizes(partsFromBreaks(paragraphs, planChapterBreaks(paragraphs, 2000)))).toEqual([2000, 2000, 2000]);
  });

  it("作者直接指定段数时照这个数拆，不再看字数够不够", () => {
    const paragraphs = Array.from({ length: 12 }, () => paragraph(250));

    // 3000 字按 2400 一章算不出第二段，但作者说了拆三段就拆三段
    expect(planChapterBreaks(paragraphs, 2400)).toEqual([]);
    expect(sizes(partsFromBreaks(paragraphs, planChapterBreaks(paragraphs, 2400, 3)))).toEqual([1000, 1000, 1000]);
  });

  it("要不到的段数逐级降，而不是直接放弃", () => {
    // 三段共 1500 字，拆 5 段会切出碎片；降到 3 段正好每段 500
    expect(sizes(partsFromBreaks(
      [paragraph(500), paragraph(500), paragraph(500)],
      planChapterBreaks([paragraph(500), paragraph(500), paragraph(500)], 2400, 5),
    ))).toEqual([500, 500, 500]);
  });
});

describe("planBalancedBreaks", () => {
  it("长短不齐的段落也能均分，而不是前面塞满后面留尾巴", () => {
    const paragraphs = [paragraph(1800), paragraph(200), paragraph(1800), paragraph(200), paragraph(2000)];

    expect(sizes(partsFromBreaks(paragraphs, planBalancedBreaks(paragraphs, 3)))).toEqual([2000, 2000, 2000]);
  });

  it("任何切法都会出碎片时返回空数组", () => {
    expect(planBalancedBreaks([paragraph(3000), paragraph(100)], 2)).toEqual([]);
  });

  it("段数不足 2 时不切", () => {
    expect(planBalancedBreaks([paragraph(3000), paragraph(3000)], 1)).toEqual([]);
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

  it("作者直接报章数时按字数把名额分到各章", async () => {
    // 两章 4000 / 8000 字拆成 6 章：长的分 4 段、短的分 2 段，每段都是 2000
    const { client } = clientReturning([JSON.stringify({ titles: [] }), JSON.stringify({ titles: [] })]);
    const result = await planChapterSplits(client, [
      { targetId: 150, title: "第 150 章", content: Array.from({ length: 8 }, () => paragraph(500)).join("\n\n") },
      { targetId: 151, title: "第 151 章", content: Array.from({ length: 16 }, () => paragraph(500)).join("\n\n") },
    ], { targetWords: 2400, targetParts: 6 });

    const byId = new Map(result.splits.map(item => [item.targetId, item]));
    expect(byId.get(150)?.titles).toHaveLength(2);
    expect(byId.get(151)?.titles).toHaveLength(4);
    expect(result.splits.reduce((sum, item) => sum + item.titles.length, 0)).toBe(6);
  });

  it("指定章数时不算超长的章也会被拆", async () => {
    const { client } = clientReturning([JSON.stringify({ titles: [] })]);
    const source = { targetId: 155, title: "第 155 章", content: Array.from({ length: 12 }, () => paragraph(250)).join("\n\n") };

    // 3000 字按每章 2400 算不需要拆
    expect((await planChapterSplits(client, [source], { targetWords: 2400 })).splits).toEqual([]);
    // 作者说拆成两章就拆
    const forced = await planChapterSplits(client, [source], { targetWords: 2400, targetParts: 2 });
    expect(forced.splits[0]?.titles).toHaveLength(2);
  });
  it("段落数不够切到要的章数时如实说明切不出", async () => {
    const { client } = clientReturning([JSON.stringify({ titles: [] })]);
    const result = await planChapterSplits(client, [
      { targetId: 160, title: "第 160 章 短章", content: [paragraph(200), paragraph(200)].join("\n\n") },
    ], { targetWords: 2400, targetParts: 3 });

    expect(result.splits).toEqual([]);
    expect(result.failures[0]).toContain("切不出");
  });

  it("报了总章数而某章只分到一章时，那一章原样保留", async () => {
    // 两章 6000 / 1200 字拆成 3 章：6000 字那章切成两章，1200 字那章原样算第三章，不能为了凑数再切它一刀
    const { client } = clientReturning([JSON.stringify({ titles: [] })]);
    const result = await planChapterSplits(client, [
      { targetId: 150, title: "第 150 章", content: Array.from({ length: 12 }, () => paragraph(500)).join("\n\n") },
      { targetId: 151, title: "第 151 章", content: Array.from({ length: 4 }, () => paragraph(300)).join("\n\n") },
    ], { targetWords: 2000, targetParts: 3 });

    expect(result.splits.map(item => item.targetId)).toEqual([150]);
    expect(result.splits[0].titles).toHaveLength(2);
    expect(result.failures[0]).toContain("保持原样");
  });

  it("报的章数不比现有章数多时退回每章字数，不把整批跳过", async () => {
    // 模型把“每章拆 2 章”当成总数填成 2：两章拆成两章等于没拆，只能按字数口径走
    const { client } = clientReturning([JSON.stringify({ titles: [] }), JSON.stringify({ titles: [] })]);
    const long = Array.from({ length: 12 }, () => paragraph(500)).join("\n\n");
    const result = await planChapterSplits(client, [
      { targetId: 150, title: "第 150 章", content: long },
      { targetId: 151, title: "第 151 章", content: long },
    ], { targetWords: 2000, targetParts: 2 });

    expect(result.splits.map(item => item.targetId)).toEqual([150, 151]);
    expect(result.failures[0]).toContain("没法当成拆完后的总章数");
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
