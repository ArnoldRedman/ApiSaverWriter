import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "../src/application/concurrency.js";
import { generateChapterTitles, isPlaceholderChapterTitle } from "../src/application/chapter-titles.js";
import { ModelApiClient } from "../src/models/model-api.js";

const clientReturning = (bodies: string[]) => {
  const chat = vi.fn().mockImplementation(() => Promise.resolve({ content: bodies.shift() ?? "{}", model: "test" }));
  return { client: { chat } as unknown as ModelApiClient, chat };
};

describe("mapWithConcurrency", () => {
  it("按输入顺序返回结果，与完成顺序无关", async () => {
    const delays = [30, 5, 20, 1];
    const output = await mapWithConcurrency(delays, 2, async (delay, index) =>
      new Promise<string>(resolve => setTimeout(() => resolve(`#${index}:${delay}`), delay)));

    expect(output).toEqual(["#0:30", "#1:5", "#2:20", "#3:1"]);
  });

  it("同时在跑的任务数不超过上限", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 9 }, (_, index) => index), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running -= 1;
      return true;
    });

    expect(peak).toBe(3);
  });

  it("空输入不启动任何 worker", async () => {
    const run = vi.fn();
    expect(await mapWithConcurrency([], 4, run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("isPlaceholderChapterTitle", () => {
  it("认得出创建时的编号占位和空标题", () => {
    for (const title of ["第 12 章", "第十二章", "新章节", "未命名章节", "无标题", "  ", ""]) {
      expect(isPlaceholderChapterTitle(title)).toBe(true);
    }
  });

  it("作者已经起过的名字不算占位", () => {
    for (const title of ["第 12 章 夜雨敲窗", "夜雨敲窗", "第十二章 旧仓库的账本"]) {
      expect(isPlaceholderChapterTitle(title)).toBe(false);
    }
  });
});

describe("generateChapterTitles", () => {
  it("正文开头写着标题的章节零调用捡回来", async () => {
    const { client, chat } = clientReturning([]);

    const result = await generateChapterTitles(client, [
      { targetId: 150, currentTitle: "第 150 章", content: "## 第一百五十章 旧仓库的账本\n\n林舟翻开账本。" },
      { targetId: 151, currentTitle: "第 151 章", content: "### 夜雨敲窗\n\n夜雨又落下来。" },
    ]);

    expect(chat).not.toHaveBeenCalled();
    expect(result.recovered).toBe(2);
    expect(result.named).toBe(0);
    // 章号一律用应用自己的编号，模型写错的“第一百五十章”前缀被剥掉
    expect(result.entries).toEqual([
      { targetId: 150, title: "第 150 章 旧仓库的账本", stripHeading: true },
      { targetId: 151, title: "第 151 章 夜雨敲窗", stripHeading: true },
    ]);
  });

  it("正文里没有标题时才分批交给模型命名", async () => {
    const { client, chat } = clientReturning([
      JSON.stringify({ titles: [{ id: 150, title: "旧仓库的账本" }, { id: 151, title: "夜雨里的口供" }] }),
    ]);

    const result = await generateChapterTitles(client, [
      { targetId: 150, currentTitle: "第 150 章", content: "林舟翻开账本，纸页上只有一行数字。" },
      { targetId: 151, currentTitle: "新章节", content: "夜雨落在窗框上，他把口供压在灯下。" },
    ], { projectTitle: "城南夜雨", instruction: "标题贴合本章事件" });

    expect(chat).toHaveBeenCalledOnce();
    const [messages] = chat.mock.calls[0] as [Array<{ role: string; content: string }>];
    expect(messages[1].content).toContain("城南夜雨");
    expect(messages[1].content).toContain("标题贴合本章事件");
    expect(messages[1].content).toContain("id=150");
    expect(result.recovered).toBe(0);
    expect(result.named).toBe(2);
    // 有章号的沿用章号，没章号的直接用模型给的名字
    expect(result.entries).toEqual([
      { targetId: 150, title: "第 150 章 旧仓库的账本" },
      { targetId: 151, title: "夜雨里的口供" },
    ]);
    expect(result.failures).toEqual([]);
  });

  it("一批失败只丢这一批，其余章节照常返回", async () => {
    const chat = vi.fn()
      .mockRejectedValueOnce(new Error("无法连接 API 中转服务，已自动重试 3 次"))
      .mockResolvedValueOnce({ content: JSON.stringify({ titles: [{ id: 21, title: "码头的第二封信" }] }), model: "test" });
    const client = { chat } as unknown as ModelApiClient;
    const candidates = Array.from({ length: 21 }, (_, index) => ({
      targetId: index + 1,
      currentTitle: `第 ${index + 1} 章`,
      content: `第 ${index + 1} 章的正文内容，林舟继续核对档案。`,
    }));

    const result = await generateChapterTitles(client, candidates);

    // 20 章一批：第一批整批失败，第二批的一章正常产出
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.entries).toEqual([{ targetId: 21, title: "第 21 章 码头的第二封信" }]);
    expect(result.failures.some(item => item.includes("20 章命名失败") && item.includes("无法连接"))).toBe(true);
  });

  it("模型漏掉的章节如实报出来，不假装全部完成", async () => {
    const { client } = clientReturning([JSON.stringify({ titles: [{ id: 1, title: "入城" }] })]);

    const result = await generateChapterTitles(client, [
      { targetId: 1, currentTitle: "第 1 章", content: "林舟抵达城南。" },
      { targetId: 2, currentTitle: "第 2 章", content: "夜雨中他确认旧书来自码头。" },
    ]);

    expect(result.entries).toHaveLength(1);
    expect(result.failures[0]).toContain("有 1 章模型没给出可用标题");
  });

  it("没有正文的章节不去调模型，直接报为失败", async () => {
    const { client, chat } = clientReturning([]);

    const result = await generateChapterTitles(client, [{ targetId: 7, currentTitle: "第 7 章", content: "   " }]);

    expect(chat).not.toHaveBeenCalled();
    expect(result.entries).toEqual([]);
    expect(result.failures[0]).toContain("章节 7 没有正文");
  });

  it("进度回调随批次推进，前端进度条不会整段停住", async () => {
    const { client } = clientReturning([JSON.stringify({ titles: [{ id: 2, title: "夜雨" }] })]);
    const seen: Array<[number, number]> = [];

    await generateChapterTitles(client, [
      { targetId: 1, currentTitle: "第 1 章", content: "## 第一章 入城\n\n林舟抵达城南。" },
      { targetId: 2, currentTitle: "第 2 章", content: "夜雨中他确认旧书来自码头。" },
    ], { onProgress: (done, total) => seen.push([done, total]) });

    expect(seen).toEqual([[1, 2], [2, 2]]);
  });
});
