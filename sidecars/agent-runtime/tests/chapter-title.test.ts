import { describe, expect, it } from "vitest";
import { applyDraftChapterTitle } from "../src/application/chapter-titles.js";

describe("chapter title from draft heading", () => {
  it("fills a numbered placeholder and keeps the app's own chapter number", () => {
    expect(applyDraftChapterTitle("第 4 章", "第四章 夜访寒潭")).toBe("第 4 章 夜访寒潭");
    expect(applyDraftChapterTitle("第 4 章", "夜访寒潭")).toBe("第 4 章 夜访寒潭");
    expect(applyDraftChapterTitle("第 4 章", "第四章：夜访寒潭")).toBe("第 4 章 夜访寒潭");
  });

  it("never overwrites a title the author or planner already chose", () => {
    expect(applyDraftChapterTitle("第 4 章 旧城门", "第四章 夜访寒潭")).toBe("第 4 章 旧城门");
    expect(applyDraftChapterTitle("楔子", "第四章 夜访寒潭")).toBe("楔子");
  });

  it("keeps the placeholder when the draft heading carries no title name", () => {
    expect(applyDraftChapterTitle("第 4 章", "第四章")).toBe("第 4 章");
    expect(applyDraftChapterTitle("第 4 章", "")).toBe("第 4 章");
  });
});
