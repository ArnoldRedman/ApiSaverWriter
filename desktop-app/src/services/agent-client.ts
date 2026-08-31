import type { AgentRpcMethod } from '@zhizhang/contracts';
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
  // 不再在每次 RPC 前调用 start_agent_runtime：该命令会争抢 Agent 进程锁，
  // 长任务进行中时会把等待转嫁到主线程并冻结界面。call_agent_rpc 自己会按需拉起进程。
  return invoke<Result>('call_agent_rpc', { method, params });
};
