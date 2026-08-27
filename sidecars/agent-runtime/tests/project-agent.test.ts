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

const delegates = () => ({ chapter: vi.fn(), outline: vi.fn(), card: vi.fn() });

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
      contextWindowKB: 64,
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
});
