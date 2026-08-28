import type { AgentRpcMethod } from '@apisaverwriter/contracts';
import { invoke } from '../platform';

/**
 * Agent Runtime 的唯一前端入口
 * 方法名受共享契约约束；返回值形状由调用方按需窄化
 */
export const ensureAgentRuntime = () => invoke<string>('start_agent_runtime');

export const agentRpc = async <Result>(
  method: AgentRpcMethod,
  params: Record<string, unknown>,
): Promise<Result> => {
  await ensureAgentRuntime();
  return invoke<Result>('call_agent_rpc', { method, params });
};
