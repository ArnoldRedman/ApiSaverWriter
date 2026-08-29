export type ApiMode = 'openai' | 'anthropic';
export type ReasoningMode = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max';

export interface AgentConfig {
  serviceName: string;
  enabled: boolean;
  apiMode: ApiMode;
  baseURL: string;
  /** 每个配置只有一个 Key；需要多个供应商就新建多个配置，在列表里切换 */
  apiKey: string;
  model: string;
  enabledModels: string[];
  contextWindow: number;
  reasoningMode: ReasoningMode;
  proxyEnabled: boolean;
  proxyURL: string;
  proxyBypassLocal: boolean;
}

export const defaultBaseURL = 'https://api.apisaver.com/v1';
export const defaultAnthropicBaseURL = 'https://api.anthropic.com';
export const apiModes: Array<{ value: ApiMode; label: string; hint: string; placeholder: string; endpoint: string }> = [
  { value: 'openai', label: 'OpenAI 兼容', hint: '走 /v1/chat/completions，请求头 Authorization: Bearer', placeholder: 'https://api.example.com/v1', endpoint: '/v1/chat/completions' },
  { value: 'anthropic', label: 'Anthropic Messages', hint: '走 /v1/messages，请求头 x-api-key + anthropic-version', placeholder: 'https://api.anthropic.com', endpoint: '/v1/messages' },
];
export const apiModeLabel = (mode: ApiMode) => apiModes.find(item => item.value === mode)?.label ?? 'OpenAI 兼容';
export const defaultBaseURLFor = (mode: ApiMode) => mode === 'anthropic' ? defaultAnthropicBaseURL : defaultBaseURL;
/** OpenAI-compatible relays are addressed by their `/v1` root, Anthropic ones by
 * the host that serves `/v1/messages`. Returns '' for an unusable address so
 * callers can report it instead of silently falling back. */
export const normalizeBaseURL = (value: string, mode: ApiMode = 'openai') => {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return defaultBaseURLFor(mode);
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  } catch {
    return '';
  }
  if (mode === 'anthropic') return trimmed.replace(/\/v1(?:\/messages)?$/i, '') || trimmed;
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
};
/** Resolved URL the request will actually hit, shown next to the address field. */
export const resolvedEndpoint = (config: Pick<AgentConfig, 'apiMode' | 'baseURL'>) => {
  const base = normalizeBaseURL(config.baseURL, config.apiMode);
  if (!base) return '';
  return config.apiMode === 'anthropic' ? `${base}/v1/messages` : `${base}/chat/completions`;
};
// The gateway dashboard reads New API endpoints that only the managed ApiSaver
// relay serves, so both the protocol and the host have to match.
export const isDefaultApiService = (config: Pick<AgentConfig, 'apiMode' | 'baseURL'>) =>
  config.apiMode === 'openai' && normalizeBaseURL(config.baseURL, 'openai') === defaultBaseURL;

export const contextWindowPresets = [64, 128, 200, 256, 512, 1024, 2048];
export const maxContextWindowKTokens = 2048;
export const formatContextWindow = (value: number) => value >= 1024 ? `${(value / 1024).toFixed(value % 1024 ? 1 : 0)}M tokens` : `${value}K tokens`;
export const clampContextWindow = (value: unknown) => Math.min(maxContextWindowKTokens, Math.max(16, Number(value) || 128));
export const reasoningModes: Array<{ value: ReasoningMode; hint: string }> = [
  { value: 'auto', hint: '不发送思考参数，由模型自行决定' },
  { value: 'off', hint: '明确关闭思考' },
  { value: 'low', hint: 'Anthropic 思考预算 2K tokens' },
  { value: 'medium', hint: 'Anthropic 思考预算 6K tokens' },
  { value: 'high', hint: 'Anthropic 思考预算 12K tokens' },
  { value: 'max', hint: 'Anthropic 思考预算 24K tokens；OpenAI 兼容接口没有 max，会按 high 发送' },
];
export const fallbackModels = ['gpt-5.6-luna', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.4'];
export const normalizeAgentConfig = (value: unknown): AgentConfig => {
  const parsed = value && typeof value === 'object' ? value as Partial<AgentConfig> & Record<string, unknown> : {};
  // 旧版本存过 apiKeys 数组；只保留第一个，多 Key 轮换曾导致重试换 Key 报 403
  const legacyKeys = Array.isArray((parsed as Record<string, unknown>).apiKeys)
    ? ((parsed as Record<string, unknown>).apiKeys as unknown[]).filter((key): key is string => typeof key === 'string' && Boolean(key.trim())).map(key => key.trim())
    : [];
  const apiKey = typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : legacyKeys[0] || '';
  const apiMode: ApiMode = parsed.apiMode === 'anthropic' ? 'anthropic' : 'openai';
  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : fallbackModels[0];
  const enabledModels = Array.from(new Set([
    ...(Array.isArray(parsed.enabledModels) ? parsed.enabledModels : []).filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()),
    model,
  ]));
  // 旧版本曾保存字节数；超过 4096 的值只可能来自旧单位，迁移为 K tokens 档位
  const storedWindow = Number((parsed as Record<string, unknown>).contextWindowKB ?? parsed.contextWindow) || 0;
  const storedReasoning = (parsed as Record<string, unknown>).reasoningMode;
  return {
    serviceName: typeof parsed.serviceName === 'string' ? parsed.serviceName : 'ApiSaver（省API）',
    enabled: parsed.enabled !== false,
    apiMode,
    baseURL: normalizeBaseURL(typeof parsed.baseURL === 'string' ? parsed.baseURL : defaultBaseURLFor(apiMode), apiMode) || defaultBaseURLFor(apiMode),
    apiKey,
    model,
    enabledModels,
    contextWindow: clampContextWindow(storedWindow > maxContextWindowKTokens * 2 ? storedWindow / 1024 : storedWindow),
    // `custom` disappeared with the English effort scale; it behaved as medium.
    reasoningMode: storedReasoning === 'custom' ? 'medium'
      : reasoningModes.some(item => item.value === storedReasoning) ? storedReasoning as ReasoningMode : 'auto',
    proxyEnabled: parsed.proxyEnabled === true,
    proxyURL: typeof parsed.proxyURL === 'string' && parsed.proxyURL.trim() ? parsed.proxyURL : 'http://127.0.0.1:7897',
    proxyBypassLocal: parsed.proxyBypassLocal === true,
  };
};

export interface AgentProfile extends AgentConfig {
  id: string;
}
export const profilesStorageKey = 'agent-profiles';
export const activeProfileStorageKey = 'agent-active-profile';
export const newProfileId = () => `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const normalizeAgentProfile = (value: unknown): AgentProfile => {
  const parsed = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    ...normalizeAgentConfig(parsed),
    id: typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : newProfileId(),
  };
};
/** Reads the profile list, promoting a pre-upgrade single `agent-config` into
 * profile #1 so an existing install keeps its keys and models. */
export const loadAgentProfiles = (): { profiles: AgentProfile[]; activeId: string } => {
  let profiles: AgentProfile[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem(profilesStorageKey) || '[]') as unknown;
    profiles = Array.isArray(saved) ? saved.map(normalizeAgentProfile) : [];
  } catch {
    profiles = [];
  }
  if (!profiles.length) {
    try {
      const legacy = localStorage.getItem('agent-config');
      const legacyModels = JSON.parse(localStorage.getItem('agent-models') || '[]') as unknown;
      profiles = [normalizeAgentProfile({
        ...(legacy ? JSON.parse(legacy) as Record<string, unknown> : {}),
        ...(Array.isArray(legacyModels) && legacyModels.length ? { enabledModels: legacyModels } : {}),
      })];
    } catch {
      profiles = [normalizeAgentProfile({})];
    }
  }
  const storedActive = localStorage.getItem(activeProfileStorageKey) || '';
  return { profiles, activeId: profiles.some(profile => profile.id === storedActive) ? storedActive : profiles[0].id };
};
export const profilePresets: Array<{ id: string; label: string; hint: string; config: Partial<AgentConfig> }> = [
  { id: 'apisaver', label: 'ApiSaver（省API）', hint: 'OpenAI 兼容 · 官方中转站', config: { serviceName: 'ApiSaver（省API）', apiMode: 'openai', baseURL: defaultBaseURL, model: fallbackModels[0] } },
  { id: 'anthropic', label: 'Anthropic 官方', hint: 'Messages · api.anthropic.com', config: { serviceName: 'Anthropic 官方', apiMode: 'anthropic', baseURL: defaultAnthropicBaseURL, model: 'claude-opus-5', enabledModels: ['claude-opus-5'] } },
  { id: 'openai-relay', label: '自定义中转（OpenAI 兼容）', hint: '任意支持 /v1/chat/completions 的地址', config: { serviceName: '自定义中转站', apiMode: 'openai', baseURL: defaultBaseURL } },
  { id: 'anthropic-relay', label: '自定义中转（Anthropic）', hint: '任意支持 /v1/messages 的地址', config: { serviceName: '自定义 Claude 中转', apiMode: 'anthropic', baseURL: defaultAnthropicBaseURL } },
];

/** Mirror of the runtime's `settings.diagnose` result. */
export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}
export interface DiagnosticReport {
  mode: ApiMode;
  modelsEndpoint: string;
  chatEndpoint: string;
  checks: DiagnosticCheck[];
}
export const diagnosticStatusIcon: Record<DiagnosticCheck['status'], string> = { pass: '✓', warn: '!', fail: '×' };
export const agentNetworkParams = (config: AgentConfig) => ({
  proxyEnabled: config.proxyEnabled,
  proxyURL: config.proxyURL.trim(),
  proxyBypassLocal: config.proxyBypassLocal,
});
