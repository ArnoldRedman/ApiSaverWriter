import { invoke as nativeInvoke } from '@tauri-apps/api/core';

type InvokeArgs = Record<string, unknown> | undefined;
const mobileRuntime = () => '__TAURI_INTERNALS__' in window && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const gatewayURL = () => {
  try {
    const config = JSON.parse(localStorage.getItem('agent-config') || '{}') as { mobileGatewayURL?: string };
    return String(config.mobileGatewayURL || '').trim().replace(/\/$/u, '');
  } catch { return ''; }
};

const callGateway = async <T>(method: string, params: Record<string, unknown>) => {
  const endpoint = gatewayURL();
  if (!endpoint) throw new Error('移动端需要在设置中填写 Agent Gateway 地址，才能使用智能体、书源和榜单功能。');
  const response = await fetch(`${endpoint}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ method, params }) });
  if (!response.ok || !response.body) throw new Error(`Agent Gateway 请求失败：${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const item of events) {
      const event = item.match(/^event:\s*(.+)$/m)?.[1] || 'message';
      const raw = item.match(/^data:\s*(.+)$/m)?.[1];
      if (!raw) continue;
      const payload = JSON.parse(raw) as { result?: T; error?: { message?: string }; message?: string };
      if (event === 'agent-progress') window.dispatchEvent(new CustomEvent('agent-progress', { detail: payload }));
      if (event === 'error') throw new Error(payload.error?.message || payload.message || 'Agent Gateway 运行失败');
      if (event === 'result') {
        if (payload.error) throw new Error(payload.error.message || 'Agent Gateway 调用失败');
        result = payload.result;
      }
    }
    if (done) break;
  }
  return result as T;
};

/** Uses native Tauri commands everywhere, with mobile RPC forwarded to Gateway. */
export const invoke = async <T>(command: string, args?: InvokeArgs): Promise<T> => {
  if (!mobileRuntime()) return nativeInvoke<T>(command, args);
  if (command === 'start_agent_runtime') {
    if (!gatewayURL()) throw new Error('请在设置中配置移动端 Agent Gateway 地址。');
    return 'Mobile Agent Gateway ready' as T;
  }
  if (command === 'call_agent_rpc') {
    const input = args as { method?: string; params?: Record<string, unknown> } | undefined;
    if (!input?.method) throw new Error('缺少 Agent RPC 方法。');
    return callGateway<T>(input.method, input.params || {});
  }
  if (command === 'detect_system_proxy') return null as T;
  return nativeInvoke<T>(command, args);
};

export const isMobileRuntime = mobileRuntime;
