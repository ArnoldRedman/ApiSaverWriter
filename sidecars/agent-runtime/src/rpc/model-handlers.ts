import { getRuntimeUsageSummary } from "../models/api-saver.js";
import { createModelClient } from "../application/model-client.js";
import type { RpcRegistry } from "./registry.js";

export const registerModelHandlers = (registry: RpcRegistry): RpcRegistry => registry
  .register("usage.summary", async () => getRuntimeUsageSummary())
  .register("gateway.usage", async params => createModelClient(params).getGatewayUsageSnapshot())
  .register("settings.diagnose", async params => createModelClient(params, { model: String(params.model || ""), allowMissingKey: true }).diagnose(String(params.model || "")))
  .register("models.list", async params => ({ models: await createModelClient(params).listModels() }))
  .register("models.test", async params => {
    const model = String(params.model || "");
    const client = createModelClient(params, { model, requireModel: true });
    await client.chat([{ role: "user", content: "请只回复 OK" }], { max_tokens: 256, temperature: 0, retryAttempts: 2 });
    return { tested: true, model };
  });
