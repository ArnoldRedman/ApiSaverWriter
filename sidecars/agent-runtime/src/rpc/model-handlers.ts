import { getRuntimeUsageSummary } from "../models/model-api.js";
import { createModelApiClient } from "../application/model-client.js";
import type { RpcRegistry } from "./registry.js";

export const registerModelHandlers = (registry: RpcRegistry): RpcRegistry => registry
  .register("usage.summary", async () => getRuntimeUsageSummary())
  .register("gateway.usage", async params => createModelApiClient(params).getGatewayUsageSnapshot())
  .register("settings.diagnose", async params => createModelApiClient(params, { model: String(params.model || ""), allowMissingKey: true }).diagnose(String(params.model || "")))
  .register("models.list", async params => ({ models: await createModelApiClient(params).listModels() }))
  .register("models.test", async params => {
    const model = String(params.model || "");
    const client = createModelApiClient(params, { model, requireModel: true });
    await client.chat([{ role: "user", content: "请只回复 OK" }], { max_tokens: 256, temperature: 0, retryAttempts: 2 });
    return { tested: true, model };
  });
