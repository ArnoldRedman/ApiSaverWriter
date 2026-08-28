import { describe, expect, it } from "vitest";
import { countMessageTokens, countTextTokens, fitMessagesToTokenBudget, tokenizerEncodingForModel } from "../src/context/token-budget.js";

describe("token budget", () => {
  it("uses model tokenizer counts instead of character counts", () => {
    expect(countTextTokens("你好世界", "gpt-4o")).toBe(2);
    expect(countTextTokens("你好世界", "gpt-4")).toBe(5);
    expect(tokenizerEncodingForModel("gpt-5.6-sol")).toBe("o200k_base");
  });

  it("fits messages inside the configured token budget", () => {
    const messages = [
      { role: "system" as const, content: "保持人物设定一致" },
      { role: "user" as const, content: `旧资料${"中".repeat(300)}` },
      { role: "user" as const, content: `最新任务${"后".repeat(300)}` },
    ];
    const fitted = fitMessagesToTokenBudget(messages, 180, "gpt-4o");
    expect(countMessageTokens(fitted, "gpt-4o")).toBeLessThanOrEqual(180);
    expect(fitted[0].content).toContain("人物设定");
    expect(fitted.at(-1)?.content).toContain("最新任务");
  });
});
