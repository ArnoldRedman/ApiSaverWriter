import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiSaverClient, buildModelConfig, createChatModel } from "../src/models/api-saver.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("API Saver model configuration", () => {
  it("normalizes an OpenAI-compatible API Saver base URL", () => {
    expect(buildModelConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.apisaver.com",
    })).toEqual({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.apisaver.com/v1",
    });
  });

  it("preserves an explicit Claude messages endpoint", () => {
    expect(buildModelConfig({
      provider: "claude",
      apiKey: "test-key",
      model: "claude-3-5-sonnet",
      baseUrl: "https://api.apisaver.com/v1/messages",
    }).baseUrl).toBe("https://api.apisaver.com/v1/messages");
  });

  it("creates a LangChain chat model for both providers", () => {
    expect(createChatModel(buildModelConfig({ provider: "openai", apiKey: "x", model: "gpt-4o-mini" }))._llmType()).toBe("openai");
    expect(createChatModel(buildModelConfig({ provider: "claude", apiKey: "x", model: "claude-3-5-sonnet" }))._llmType()).toBe("anthropic");
  });

  it("retries temporary gateway failures before returning a response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "gpt-test",
        choices: [{ message: { content: "生成完成" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const request = new ApiSaverClient({ apiKey: "test-key", baseURL: "https://example.test/v1", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }]);
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ content: "生成完成", model: "gpt-test" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rotates through configured supplier keys on retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "gpt-test",
        choices: [{ message: { content: "OK" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const request = new ApiSaverClient({ apiKey: "primary-key", apiKeys: ["primary-key", "backup-key"], baseURL: "https://example.test/v1", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }]);
    await vi.runAllTimersAsync();
    await expect(request).resolves.toEqual({ content: "OK", model: "gpt-test" });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer primary-key" });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer backup-key" });
  });

  it("does not retry an exhausted quota response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: "The quota has been exceeded" } }), { status: 429 }));

    const request = new ApiSaverClient({ apiKey: "test-key", baseURL: "https://example.test/v1", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }]);

    await expect(request).rejects.toThrow("API 中转服务额度已用尽");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
