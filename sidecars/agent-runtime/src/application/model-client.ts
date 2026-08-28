import { ApiSaverClient, normalizeWireMode } from "../models/api-saver.js";

export const stringList = (value: unknown, limit = 20): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean).slice(0, limit)
  : [];

export const networkProxyConfig = (params?: Record<string, unknown>) => ({
  proxyEnabled: params?.proxyEnabled === true,
  proxyURL: typeof params?.proxyURL === "string" ? params.proxyURL : "",
  proxyBypassLocal: params?.proxyBypassLocal === true,
});

export const createModelClient = (params: Record<string, unknown>, defaults: { model?: string; requireModel?: boolean; allowMissingKey?: boolean } = {}) => {
  const apiKey = String(params.apiKey || "");
  const model = String(params.model || defaults.model || "");
  if ((!apiKey && !defaults.allowMissingKey) || (defaults.requireModel && !model)) {
    throw new Error(defaults.requireModel ? "缺少模型配置" : "请先在设置中填写 API Key。");
  }
  return new ApiSaverClient({
    apiKey,
    apiKeys: stringList(params.apiKeys, 12),
    baseURL: String(params.baseURL || "https://api.apisaver.com/v1"),
    defaultModel: model,
    apiMode: normalizeWireMode(params.apiMode),
    reasoningMode: String(params.reasoningMode || "auto"),
    contextWindowKTokens: Number(params.contextWindow) || undefined,
    ...networkProxyConfig(params),
  });
};
