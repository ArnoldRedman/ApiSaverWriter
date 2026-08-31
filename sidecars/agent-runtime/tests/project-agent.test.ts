import { describe, expect, it, vi } from "vitest";
import { ApiSaverClient } from "../src/models/api-saver.js";
import { buildProjectAgentContext, ProjectAgentChangeSchema, runProjectAgent } from "../src/project-agent.js";

const project = {
  id: 42,
  title: "城南夜雨",
  synopsis: "林舟在城南整理一批旧书档案。",
  chapters: [
    { id: 1, title: "第一章 入城", content: "林舟抵达城南书店，发现一本缺少借阅记录的旧书。" },
    { id: 2, title: "第二章 夜雨", content: "夜雨中，林舟确认旧书来自码头仓库，并决定次日前往核对。" },
  ],
  outlines: [{ id: 11, kind: "章纲", title: "章纲｜第三章 旧仓库", content: "林舟前往旧仓库，找到新的档案线索。" }],
  cards: [{ id: 21, type: "角色卡", title: "林舟", content: "谨慎，擅长整理档案。", currentState: "准备前往旧仓库" }],
  memories: [],
  memoryDocuments: [{ id: "memory-document:伏笔追踪", kind: "伏笔追踪", title: "伏笔追踪", content: "旧书的借阅记录尚待确认。" }],
  graphNodes: [{ id: "card:21", label: "林舟", type: "card", category: "角色卡" }],
  graphEdges: [],
};

const delegates = () => ({ chapter: vi.fn(), chapterRevise: vi.fn(), outline: vi.fn(), card: vi.fn() });

const clientWith = (content: string) => ({
  chat: vi.fn().mockResolvedValue({ content, model: "test" }),
}) as unknown as ApiSaverClient;

describe("project agent", () => {
  it("selects relevant project documents within the context packet", () => {
    const context = buildProjectAgentContext({
      mode: "discuss",
      instruction: "整理林舟前往旧仓库前掌握的线索和待确认事项",
      project,
      activeChapterId: 2,
      contextWindowKTokens: 64,
    });

    expect(context.packet).toContain("角色卡｜21｜林舟");
    expect(context.packet).toContain("章纲｜11｜章纲｜第三章 旧仓库");
    expect(context.packet).toContain("伏笔追踪");
    expect(context.sources.length).toBeGreaterThan(0);
  });

  it("forces discuss mode to remain read-only", async () => {
    const client = clientWith(JSON.stringify({
      message: "林舟目前确认旧书来自码头仓库，下一步应核对仓库档案与借阅记录。",
      changes: [{
        type: "card.upsert",
        summary: "更新林舟状态",
        targetId: 21,
        cardType: "角色卡",
        title: "林舟",
        content: "准备前往旧仓库核对档案。",
      }],
    }));

    const result = await runProjectAgent({
      mode: "discuss",
      instruction: "分析林舟下一步如何整理资料",
      project,
    }, client, delegates());

    expect(result.message).toContain("仓库档案");
    expect(result.changes).toEqual([]);
    expect(result.toolEvents[0].tool).toBe("project.context");
  });

  it("delegates outline/card/chapter writing to the existing specialist agents", async () => {
    const client = clientWith(JSON.stringify({
      message: "我把林舟卡片和第三章都交给对应的智能体了。",
      changes: [
        {
          type: "card.write",
          summary: "补充林舟当前目标",
          targetId: 21,
          cardType: "角色卡",
          title: "林舟",
          instruction: "补上他核对旧仓库档案的当前目标。",
        },
        {
          type: "chapter.draft_next",
          summary: "起草第三章",
          title: "第三章 旧仓库",
          instruction: "承接夜雨结尾，写林舟前往旧仓库核对档案并发现新线索。",
          outlineId: 11,
        },
      ],
    }));
    const chapter = vi.fn().mockResolvedValue({
      type: "chapter.create",
      summary: "起草第三章",
      title: "第三章 旧仓库",
      content: "旧仓库的木门在晨风里轻响。",
      chapterPlan: "## 承接\n林舟从客栈出发。",
      chapterSummary: "林舟抵达旧仓库并找到新的档案线索。",
    });
    const card = vi.fn().mockResolvedValue({
      type: "card.upsert",
      summary: "补充林舟当前目标",
      targetId: 21,
      cardType: "角色卡",
      title: "林舟",
      content: "谨慎，擅长整理档案。当前目标：核对旧仓库中的书籍档案。",
    });

    const result = await runProjectAgent({
      mode: "execute",
      instruction: "整理林舟卡片并继续写第三章",
      project,
    }, client, { ...delegates(), chapter, card });

    // Agent 只给了 instruction，正文由专用智能体产出
    expect(card).toHaveBeenCalledWith(expect.objectContaining({ type: "card.write", targetId: 21, instruction: expect.any(String) }));
    expect(chapter).toHaveBeenCalledOnce();
    expect(result.changes.map(change => change.type)).toEqual(["card.upsert", "chapter.create"]);
    expect(result.toolEvents.some(event => event.tool === "card.write" && event.status === "complete")).toBe(true);
  });

  it("keeps the agent from authoring outline or card content itself", async () => {
    const client = clientWith(JSON.stringify({
      message: "我直接写好了卡片正文。",
      changes: [{
        type: "card.upsert",
        summary: "越过卡片智能体直接写内容",
        targetId: 21,
        cardType: "角色卡",
        title: "林舟",
        content: "我自己编的卡片正文。",
      }],
    }));

    const result = await runProjectAgent({
      mode: "execute",
      instruction: "更新林舟卡片",
      project,
    }, client, delegates());

    expect(result.changes).toEqual([]);
    expect(result.toolEvents.filter(event => event.tool === "change.reject")).toHaveLength(1);
  });

  it("rejects actions outside the allowlist", () => {
    expect(() => ProjectAgentChangeSchema.parse({
      type: "system.unsupported",
      summary: "不受支持的操作",
      targetId: 1,
    })).toThrow();
  });

  it("runs a search/open tool loop before finishing", async () => {
    const turns = [
      JSON.stringify({ action: "search", query: "旧仓库 线索" }),
      JSON.stringify({ action: "open", kind: "章节", id: "2" }),
      JSON.stringify({ action: "finish", message: "林舟已确认旧书来自码头仓库。", changes: [] }),
    ];
    const chat = vi.fn().mockImplementation(() => Promise.resolve({ content: turns.shift(), model: "test" }));
    const client = { chat } as unknown as ApiSaverClient;

    const result = await runProjectAgent({
      mode: "discuss",
      instruction: "林舟对旧仓库掌握了哪些线索",
      project,
    }, client, delegates());

    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.message).toContain("码头仓库");
    expect(result.toolEvents.map(event => event.tool)).toEqual(["project.context", "project.search", "project.open"]);
    // open 必须真的把第二章正文回灌给模型，否则循环就退化成空转
    const openTurn = chat.mock.calls[2][0] as Array<{ content: string }>;
    expect(openTurn.at(-1)?.content).toContain("码头仓库");
  });

  it("多轮检索后请求体不会无上限增长", async () => {
    // 回归：messages 只增不减，真实使用中请求体从几 KB 撑到 62 KB，做到一半突然被中转站拒绝
    const bulky = { ...project, chapters: project.chapters.map(chapter => ({ ...chapter, content: "旧仓库的档案细节。".repeat(2000) })) };
    const chat = vi.fn().mockImplementation((messages: Array<{ content: string }>) => {
      const bytes = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, "utf8"), 0);
      // 40 KB 上限叠上最后一轮的截断余量，留一些余地
      expect(bytes).toBeLessThan(48_000);
      return Promise.resolve({ content: JSON.stringify({ action: "open", kind: "章节", id: "1" }), model: "test" });
    });

    await runProjectAgent({
      mode: "discuss",
      instruction: "把旧仓库相关的章节全看一遍",
      project: bulky,
      maxSteps: 8,
    }, { chat } as unknown as ApiSaverClient, delegates());

    expect(chat).toHaveBeenCalledTimes(8);
    // 被省略早期轮次时要如实告知模型，而不是默默丢掉
    const lastTurn = chat.mock.calls.at(-1)?.[0] as Array<{ content: string }>;
    expect(lastTurn.some(message => message.content.includes("已省略较早的"))).toBe(true);
    // system 与首条请求（含项目资料）是任务前提，任何情况下都不能被丢
    expect(lastTurn[0]?.content).toContain("小说项目助手");
    expect(lastTurn[1]?.content).toContain("本轮请求");
  });

  it("stops the loop at maxSteps and still returns a result", async () => {
    const chat = vi.fn().mockResolvedValue({ content: JSON.stringify({ action: "search", query: "林舟" }), model: "test" });
    const client = { chat } as unknown as ApiSaverClient;

    const result = await runProjectAgent({
      mode: "discuss",
      instruction: "随便找点东西",
      project,
      maxSteps: 3,
    }, client, delegates());

    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.changes).toEqual([]);
    expect(result.message).toContain("没有收敛");
  });

  it("recovers when the model puts a change type in the action field", async () => {
    // 真实接口上 gpt-5.6-sol 会回 {"action":"chapter.draft_next",...}，把两套命名空间混在一起
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ action: "chapter.draft_next", summary: "起草第三章", title: "第三章 旧仓库", instruction: "承接夜雨结尾", outlineId: 0 }),
      model: "test",
    });
    const delegate = vi.fn().mockResolvedValue({
      type: "chapter.create", summary: "起草第三章", title: "第三章 旧仓库", content: "旧仓库的木门轻响。",
    });

    const result = await runProjectAgent({
      mode: "execute", instruction: "继续写第三章", project,
    }, { chat } as unknown as ApiSaverClient, { ...delegates(), chapter: delegate });

    expect(delegate).toHaveBeenCalledOnce();
    expect(result.changes.map(change => change.type)).toEqual(["chapter.create"]);
    expect(result.toolEvents.some(event => event.tool === "change.reject")).toBe(false);
  });

  it("drops one malformed change without losing the reply or the valid ones", async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ action: "finish", message: "整理完成。", changes: [
        { type: "card.write", summary: "坏的", targetId: "168", patch: { currentState: "x" } },
        { type: "card.write", summary: "好的", targetId: 21, cardType: "角色卡", title: "林舟", instruction: "补充当前目标。" },
      ] }),
      model: "test",
    });
    const card = vi.fn().mockResolvedValue({
      type: "card.upsert", summary: "好的", targetId: 21, cardType: "角色卡", title: "林舟", content: "谨慎。",
    });

    const result = await runProjectAgent({
      mode: "execute", instruction: "整理林舟卡片", project,
    }, { chat } as unknown as ApiSaverClient, { ...delegates(), card });

    expect(result.message).toBe("整理完成。");
    expect(card).toHaveBeenCalledOnce();
    expect(result.changes).toHaveLength(1);
    expect(result.toolEvents.filter(event => event.tool === "change.reject")).toHaveLength(1);
  });

  it("delegates a chapter revise and returns a chapter.update proposal", async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ action: "finish", message: "已修订第二章。", changes: [
        { type: "chapter.revise", summary: "去 AI 味", targetId: 2, instruction: "保留情节和人物口吻" },
      ] }),
      model: "test",
    });
    const chapterRevise = vi.fn().mockResolvedValue({
      type: "chapter.update", summary: "去 AI 味", targetId: 2, content: "夜雨敲在窗框上。",
    });

    const result = await runProjectAgent({
      mode: "execute", instruction: "把第二章的 AI 味去掉", project,
    }, { chat } as unknown as ApiSaverClient, { ...delegates(), chapterRevise });

    expect(chapterRevise).toHaveBeenCalledWith(expect.objectContaining({ targetId: 2, instruction: "保留情节和人物口吻" }));
    expect(result.changes).toEqual([{ type: "chapter.update", summary: "去 AI 味", targetId: 2, content: "夜雨敲在窗框上。" }]);
  });

  it("caps revises per turn so one request cannot rewrite the whole book", async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ action: "finish", message: "开始批量修订。", changes: Array.from({ length: 13 }, (_, index) => ({
        type: "chapter.revise", summary: `修订 ${index + 1}`, targetId: index + 1, instruction: "润色",
      })) }),
      model: "test",
    });
    const chapterRevise = vi.fn().mockImplementation((request: { targetId: number; summary: string }) => Promise.resolve({
      type: "chapter.update", summary: request.summary, targetId: request.targetId, content: "修订后正文。",
    }));

    const result = await runProjectAgent({
      mode: "execute", instruction: "把全书都润色一遍", project,
    }, { chat } as unknown as ApiSaverClient, { ...delegates(), chapterRevise });

    // 前 10 章真的执行，剩下的如实报错而不静默丢弃
    expect(chapterRevise).toHaveBeenCalledTimes(10);
    expect(result.changes).toHaveLength(10);
    expect(result.toolEvents.filter(event => event.tool === "chapter.revise" && event.status === "error")).toHaveLength(3);
  });

  it("整轮委派超预算后停手，剩余变更如实报出", async () => {
    // 回归：一轮最多 16 项委派，每项都要跑完整的正文生成，串行下来可能几十分钟不返回
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ action: "finish", message: "开始批量起草。", changes: Array.from({ length: 4 }, (_, index) => ({
        type: "chapter.draft_next", summary: `起草 ${index + 1}`, title: `第 ${index + 3} 章`, instruction: "承接上一章",
      })) }),
      model: "test",
    });
    const chapter = vi.fn().mockImplementation((request: { summary: string; title: string }) => new Promise(resolve => {
      setTimeout(() => resolve({ type: "chapter.create", summary: request.summary, title: request.title, content: "正文。" }), 12);
    }));

    const result = await runProjectAgent({
      mode: "execute", instruction: "一口气把后面几章都写了", project, delegateBudgetMs: 5,
    }, { chat } as unknown as ApiSaverClient, { ...delegates(), chapter });

    // 第一项在预算内开跑，跑完就超时，后面三项不再发请求
    expect(chapter).toHaveBeenCalledOnce();
    expect(result.changes).toHaveLength(1);
    const skipped = result.toolEvents.filter(event => event.tool === "chapter.draft_next" && event.status === "error");
    expect(skipped).toHaveLength(3);
    expect(skipped[0].message).toContain("未处理");
  });

  it("预算只拦委派，不影响本地就能落地的变更", async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ action: "finish", message: "整理完成。", changes: [
        { type: "memory.document.upsert", summary: "整理时间线", kind: "时间线", title: "时间线", content: "第一天入城。" },
        { type: "chapter.delete", summary: "删除空稿", targetId: 2, title: "第二章 夜雨" },
      ] }),
      model: "test",
    });

    const result = await runProjectAgent({
      mode: "execute", instruction: "整理时间线并删掉空稿", project, delegateBudgetMs: 1,
    }, { chat } as unknown as ApiSaverClient, delegates());

    expect(result.changes.map(change => change.type)).toEqual(["memory.document.upsert", "chapter.delete"]);
    expect(result.toolEvents.filter(event => event.status === "error")).toHaveLength(0);
  });
});
