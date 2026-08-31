import { ModelApiClient, normalizeWireMode } from "../models/model-api.js";

export const stringList = (value: unknown, limit = 20): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean).slice(0, limit)
  : [];

export const networkProxyConfig = (params?: Record<string, unknown>) => ({
  proxyEnabled: params?.proxyEnabled === true,
  proxyURL: typeof params?.proxyURL === "string" ? params.proxyURL : "",
  proxyBypassLocal: params?.proxyBypassLocal === true,
});

export const createModelApiClient = (params: Record<string, unknown>, defaults: { model?: string; requireModel?: boolean; allowMissingKey?: boolean } = {}) => {
  const apiKey = String(params.apiKey || "");
  const model = String(params.model || defaults.model || "");
  const baseURL = String(params.baseURL || "").trim();
  if ((!apiKey && !defaults.allowMissingKey) || (defaults.requireModel && !model)) {
    throw new Error(defaults.requireModel ? "缺少模型配置" : "请先在设置中填写 API Key。");
  }
  // Anthropic 有唯一官方地址可以兜底，OpenAI 兼容模式必须由用户填写
  if (!baseURL && normalizeWireMode(params.apiMode) === "openai") {
    throw new Error("请先在设置中填写 API 接口地址。");
  }
  return new ModelApiClient({
    apiKey,
    baseURL,
    defaultModel: model,
    apiMode: normalizeWireMode(params.apiMode),
    reasoningMode: String(params.reasoningMode || "auto"),
    contextWindowKTokens: Number(params.contextWindow) || undefined,
    ...networkProxyConfig(params),
  });
};
