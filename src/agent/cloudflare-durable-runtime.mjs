// Production wiring for the lease-fenced durable execution engine.
// Intentionally requires the Durable Object binding; never falls back to in-memory state.
import { createDurableExecutionEngine } from "./durable-execution.mjs";
import { createCloudflareCheckpointStore } from "./cloudflare-checkpoint-store.mjs";

export function createCloudflareDurableExecutionEngine({ env, executeStep, ...options } = {}) {
  if (!env?.WORKFLOW_TASKS) throw new TypeError("WORKFLOW_TASKS_BINDING_REQUIRED");
  if (typeof executeStep !== "function") throw new TypeError("STEP_EXECUTOR_REQUIRED");
  const store = createCloudflareCheckpointStore(env.WORKFLOW_TASKS);
  return createDurableExecutionEngine({ ...options, store, executeStep });
}
