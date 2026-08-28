import { isAgentRpcMethod, parseAgentRpcParams, type AgentRpcMethod, type RpcResponse } from "@apisaverwriter/contracts";

export interface RuntimeRpcRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export type RpcHandler = (params: Record<string, unknown>, request: RuntimeRpcRequest) => Promise<unknown>;

/**
 * Runtime 的组合根注册表
 * Handler 可按领域逐步迁移，未迁移方法暂时委托 legacyHandler
 */
export class RpcRegistry {
  private readonly handlers = new Map<AgentRpcMethod, RpcHandler>();

  constructor(private readonly legacyHandler: (request: RuntimeRpcRequest) => Promise<RpcResponse>) {}

  register(method: AgentRpcMethod, handler: RpcHandler): this {
    if (this.handlers.has(method)) throw new Error(`RPC 方法重复注册：${method}`);
    this.handlers.set(method, handler);
    return this;
  }

  async dispatch(request: RuntimeRpcRequest): Promise<RpcResponse> {
    if (!isAgentRpcMethod(request.method)) {
      return { id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
    let params: Record<string, unknown>;
    try {
      params = parseAgentRpcParams(request.method, request.params || {});
    } catch (error) {
      return { id: request.id, error: { code: -32602, message: error instanceof Error ? error.message : String(error) } };
    }
    const handler = this.handlers.get(request.method);
    if (!handler) return this.legacyHandler({ ...request, method: request.method, params });
    try {
      return { id: request.id, result: await handler(params, request) };
    } catch (error) {
      return { id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
