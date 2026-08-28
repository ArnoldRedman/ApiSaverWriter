import { afterEach, describe, expect, it, vi } from "vitest";
import { countMessageTokens } from "../src/context/token-budget.js";
import { ApiSaverClient, buildModelConfig, createChatModel, resetModelKeyRoutingCache, seedModelKeyRoutingCache } from "../src/models/api-saver.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetModelKeyRoutingCache();
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
    seedModelKeyRoutingCache("primary-key", ["gpt-test"], "https://example.test/v1");
    seedModelKeyRoutingCache("backup-key", ["gpt-test"], "https://example.test/v1");
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

  it("merges model lists returned by multiple configured keys", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "gpt-a" }, { id: "gpt-shared" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "gpt-shared" }, { id: "gpt-b" }] }), { status: 200 }));

    const models = await new ApiSaverClient({ apiKey: "primary-key", apiKeys: ["backup-key"], baseURL: "https://invalid.example/v1" }).listModels();

    expect(models).toEqual(["gpt-a", "gpt-shared", "gpt-b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://invalid.example/v1/models");
    expect(fetchMock.mock.calls[1][0]).toBe("https://invalid.example/v1/models");
  });

  it("uses a custom OpenAI-compatible base URL for models and chat", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "local-model" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "local-model", choices: [{ message: { content: "OK" } }] }), { status: 200 }));
    const client = new ApiSaverClient({ apiKey: "local-key", baseURL: "http://127.0.0.1:8000", defaultModel: "local-model" });

    await expect(client.listModels()).resolves.toEqual(["local-model"]);
    await expect(client.chat([{ role: "user", content: "测试" }])).resolves.toMatchObject({ content: "OK" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/v1/models");
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8000/v1/chat/completions");
  });

  it("enforces the configured context window with tokenizer counts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      model: "gpt-4o",
      choices: [{ message: { content: "OK" } }],
    }), { status: 200 }));
    const client = new ApiSaverClient({ apiKey: "k", baseURL: "https://example.test/v1", defaultModel: "gpt-4o", contextWindowKTokens: 16 });

    await client.chat([{ role: "user", content: "中".repeat(600) }], { max_tokens: 16_000, retryAttempts: 1 });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ role: "user"; content: string }> };
    expect(countMessageTokens(body.messages, "gpt-4o")).toBeLessThanOrEqual(16 * 1024 - 16_000);
    expect(body.messages[0].content.length).toBeLessThan(600);
  });
  it("uses the API key that advertised the selected model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "claude-fable-5" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "gemini-3.7-flash" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "gemini-3.7-flash", choices: [{ message: { content: "OK" } }] }), { status: 200 }));
    const client = new ApiSaverClient({ apiKey: "claude-key", apiKeys: ["gemini-key"], defaultModel: "gemini-3.7-flash" });

    await client.listModels();
    await expect(client.chat([{ role: "user", content: "测试" }])).resolves.toMatchObject({ content: "OK" });

    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ Authorization: "Bearer gemini-key" });
  });

  it("discovers the matching key before the first model request after a restart", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "claude-fable-5" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "gemini-3.7-flash" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "gemini-3.7-flash", choices: [{ message: { content: "OK" } }] }), { status: 200 }));

    await expect(new ApiSaverClient({
      apiKey: "claude-key", apiKeys: ["gemini-key"], defaultModel: "gemini-3.7-flash", apiMode: "openai",
    }).chat([{ role: "user", content: "测试" }])).resolves.toMatchObject({ content: "OK" });

    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ Authorization: "Bearer gemini-key" });
  });

  it("always uses chat completions even when an obsolete Responses mode is stored", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "gpt-5.6-terra", choices: [{ message: { content: "OK" } }] }), { status: 200 }));

    await expect(new ApiSaverClient({
      apiKey: "test-key", defaultModel: "gpt-5.6-terra", apiMode: "responses",
    }).chat([{ role: "user", content: "测试" }], { response_format: { type: "json_object" } }))
      .resolves.toMatchObject({ content: "OK" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.apisaver.com/v1/chat/completions");
  });

  it("uses the configured custom address for chat requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ model: "gpt-test", choices: [{ message: { content: "OK" } }] }), { status: 200 }));

    await expect(new ApiSaverClient({ apiKey: "test-key", baseURL: "https://legacy.example/v1", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }]))
      .resolves.toEqual({ content: "OK", model: "gpt-test" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://legacy.example/v1/chat/completions");
  });

  it("omits OpenAI-only JSON and reasoning options for Gemini-compatible models", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ model: "gemini-3.7-flash", choices: [{ message: { content: "{}" } }] }), { status: 200 }));

    await new ApiSaverClient({
      apiKey: "test-key", defaultModel: "gemini-3.7-flash", reasoningMode: "high",
    }).chat([{ role: "user", content: "请输出 JSON" }], { response_format: { type: "json_object" } });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty("response_format");
    expect(requestBody).not.toHaveProperty("reasoning");
  });

  it("extracts text from OpenAI-compatible content blocks and legacy text choices", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "gpt-test", choices: [{ message: { content: [{ type: "text", text: "第一段" }, { text: "第二段" }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "gpt-test", choices: [{ text: "旧格式正文" }] }), { status: 200 }));

    await expect(new ApiSaverClient({ apiKey: "test-key", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }])).resolves.toMatchObject({ content: "第一段\n第二段" });
    await expect(new ApiSaverClient({ apiKey: "test-key", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }])).resolves.toMatchObject({ content: "旧格式正文" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports truncation instead of a generic empty response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "gemini-3.7-flash",
      choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }],
    }), { status: 200 }));

    await expect(new ApiSaverClient({ apiKey: "test-key", defaultModel: "gemini-3.7-flash" })
      .chat([{ role: "user", content: "测试" }], { max_tokens: 8, retryAttempts: 1 }))
      .rejects.toThrow("模型输出被截断（max_tokens=8）");
  });

  it("explains when a gateway returns reasoning without visible content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "gpt-test",
      choices: [{ message: { reasoning_content: "内部推理" }, finish_reason: "stop" }],
    }), { status: 200 }));

    await expect(new ApiSaverClient({ apiKey: "test-key", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }], { retryAttempts: 1 }))
      .rejects.toThrow("只返回了推理内容");
  });

  it("finishes an SSE response on finish_reason even when the relay keeps the connection open", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "第一段" }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 7 } })}`,
            "",
          ].join("\n")));
          // Deliberately do not close: some relays omit [DONE] and leave the
          // HTTP connection open after sending the terminal choice event.
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    await expect(new ApiSaverClient({ apiKey: "test-key", defaultModel: "gpt-test" })
      .chatStream([{ role: "user", content: "测试" }]))
      .resolves.toMatchObject({ content: "第一段", model: "gpt-test" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an exhausted quota response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: "The quota has been exceeded" } }), { status: 429 }));

    const request = new ApiSaverClient({ apiKey: "test-key", baseURL: "https://example.test/v1", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }]);

    await expect(request).rejects.toThrow("API 中转服务额度已用尽");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the documented reasoning_effort field and saturates max at high", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ model: "gpt-test", choices: [{ message: { content: "OK" } }] }), { status: 200 }));

    await new ApiSaverClient({ apiKey: "test-key", defaultModel: "gpt-test", reasoningMode: "max" })
      .chat([{ role: "user", content: "测试" }]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("high");
    expect(body).not.toHaveProperty("reasoning");
  });

  it("surfaces the upstream error message instead of a bare status code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "model: claude-x not found" } }),
      { status: 400 },
    ));

    await expect(new ApiSaverClient({ apiKey: "test-key", defaultModel: "claude-x" })
      .chat([{ role: "user", content: "测试" }], { retryAttempts: 1 }))
      .rejects.toThrow("model: claude-x not found");
  });

  it("explains a 404 as a possible API format mismatch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(new ApiSaverClient({ apiKey: "test-key", defaultModel: "gpt-test" })
      .chat([{ role: "user", content: "测试" }], { retryAttempts: 1 }))
      .rejects.toThrow("切换为 Anthropic Messages");
  });
});

describe("Anthropic Messages wire protocol", () => {
  const anthropicResponse = (content: unknown, extra: Record<string, unknown> = {}) => new Response(
    JSON.stringify({ model: "claude-opus-5", content, stop_reason: "end_turn", ...extra }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

  it("resolves every address shape to the same messages endpoint", async () => {
    for (const baseURL of ["https://relay.test", "https://relay.test/v1", "https://relay.test/v1/messages"]) {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(anthropicResponse([{ type: "text", text: "OK" }]));
      await new ApiSaverClient({ apiKey: "k", baseURL, apiMode: "anthropic", defaultModel: "claude-opus-5" })
        .chat([{ role: "user", content: "测试" }]);
      expect(fetchMock.mock.calls[0][0]).toBe("https://relay.test/v1/messages");
      vi.restoreAllMocks();
    }
  });

  it("authenticates with x-api-key and pins the anthropic version", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(anthropicResponse([{ type: "text", text: "OK" }]));

    await new ApiSaverClient({ apiKey: "claude-key", apiMode: "anthropic", defaultModel: "claude-opus-5" })
      .chat([{ role: "user", content: "测试" }]);

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "claude-key", "anthropic-version": "2023-06-01" });
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });

  it("lifts system prompts out of the turn list and merges same-role turns", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(anthropicResponse([{ type: "text", text: "OK" }]));

    await new ApiSaverClient({ apiKey: "k", apiMode: "anthropic", defaultModel: "claude-opus-5" }).chat([
      { role: "system", content: "你是写作助手" },
      { role: "system", content: "保持人物一致" },
      { role: "user", content: "第一段要求" },
      { role: "user", content: "第二段要求" },
    ]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.system).toBe("你是写作助手\n\n保持人物一致");
    expect(body.messages).toEqual([{ role: "user", content: "第一段要求\n\n第二段要求" }]);
  });

  it("turns the reasoning level into a thinking budget below max_tokens", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(anthropicResponse([{ type: "text", text: "OK" }]));

    await new ApiSaverClient({ apiKey: "k", apiMode: "anthropic", defaultModel: "claude-opus-5", reasoningMode: "max" })
      .chat([{ role: "user", content: "测试" }], { max_tokens: 4000, temperature: 0.7 });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
    expect(body.max_tokens).toBe(25600);
    // Extended thinking requires the default temperature.
    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps thinking blocks out of the returned prose", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(anthropicResponse([
      { type: "thinking", thinking: "内部推理不应出现在正文" },
      { type: "text", text: "第一段" },
      { type: "text", text: "第二段" },
    ], { usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100 } }));

    await expect(new ApiSaverClient({ apiKey: "k", apiMode: "anthropic", defaultModel: "claude-opus-5" })
      .chat([{ role: "user", content: "测试" }]))
      .resolves.toMatchObject({
        content: "第一段第二段",
        model: "claude-opus-5",
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedInputTokens: 100 },
      });
  });

  it("reports truncation and thinking-only replies instead of an empty result", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(anthropicResponse([], { stop_reason: "max_tokens" }))
      .mockResolvedValueOnce(anthropicResponse([{ type: "thinking", thinking: "只有推理" }]));
    const client = new ApiSaverClient({ apiKey: "k", apiMode: "anthropic", defaultModel: "claude-opus-5" });

    await expect(client.chat([{ role: "user", content: "测试" }], { max_tokens: 8, retryAttempts: 1 }))
      .rejects.toThrow("模型输出被截断（max_tokens=8）");
    await expect(client.chat([{ role: "user", content: "测试" }], { retryAttempts: 1 }))
      .rejects.toThrow("只返回了 thinking 块");
  });

  it("lists models from the Anthropic models endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "claude-opus-5" }, { id: "claude-sonnet-5" }] }), { status: 200 }));

    await expect(new ApiSaverClient({ apiKey: "k", baseURL: "https://relay.test/v1", apiMode: "anthropic" }).listModels())
      .resolves.toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.test/v1/models");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "k" });
  });

  it("streams text_delta events, skips thinking_delta and accumulates usage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode([
            "event: message_start",
            `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 200, output_tokens: 1 } } })}`,
            "event: content_block_delta",
            `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "推理" } })}`,
            "event: content_block_delta",
            `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "正文开头" } })}`,
            "event: message_delta",
            `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } })}`,
            "event: message_stop",
            `data: ${JSON.stringify({ type: "message_stop" })}`,
            "",
          ].join("\n")));
          // Anthropic relays commonly leave the connection open after message_stop.
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));
    const chunks: string[] = [];

    await expect(new ApiSaverClient({ apiKey: "k", apiMode: "anthropic", defaultModel: "claude-opus-5" })
      .chatStream([{ role: "user", content: "测试" }], {}, chunk => chunks.push(chunk)))
      .resolves.toMatchObject({
        content: "正文开头",
        usage: { inputTokens: 200, outputTokens: 42, totalTokens: 242 },
      });
    expect(chunks).toEqual(["正文开头"]);
  });

  it("reports each preflight step and names the failing one", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "claude-opus-5" }] }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: "credit balance is too low" } }), { status: 400 }));

    const report = await new ApiSaverClient({ apiKey: "k", baseURL: "https://relay.test", apiMode: "anthropic", defaultModel: "claude-opus-5" })
      .diagnose();

    expect(report.mode).toBe("anthropic");
    expect(report.chatEndpoint).toBe("https://relay.test/v1/messages");
    expect(report.checks.map(check => [check.id, check.status])).toEqual([
      ["address", "pass"], ["keys", "pass"], ["models", "pass"], ["model", "pass"], ["chat", "fail"],
    ]);
    expect(report.checks.at(-1)?.detail).toContain("credit balance is too low");
  });

  it("fails the address check on an unusable URL without any network call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const report = await new ApiSaverClient({ apiKey: "k", baseURL: "ftp://relay.test", apiMode: "anthropic" }).diagnose();

    expect(report.checks).toEqual([{ id: "address", label: "接口地址", status: "fail", detail: "API 地址仅支持 http:// 或 https:// 协议" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
