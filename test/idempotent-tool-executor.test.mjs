import test from "node:test";
import assert from "node:assert/strict";
import { createIdempotentToolExecutor, createCloudflareIdempotentToolExecutor } from "../src/agent/idempotent-tool-executor.mjs";
import { createMemoryCheckpointStore } from "../src/agent/durable-execution.mjs";
import { createToolRegistry, createToolSession } from "../src/agent/tool-registry.mjs";

test("executes a side effect once and replays the durable result", async () => {
  const executor = createIdempotentToolExecutor({ store: createMemoryCheckpointStore() });
  let calls = 0;
  const run = () => executor.execute({
    idempotencyKey: "workflow-1:step-1:send", toolId: "send_message", arguments: { message: "hello" },
    execute: async ({ idempotencyKey }) => { calls++; return { accepted: true, idempotencyKey }; },
  });
  const first = await run(), second = await run();
  assert.equal(first.ok, true);
  assert.deepEqual(second.result, first.result);
  assert.equal(second.replayed, true);
  assert.equal(calls, 1);
});

test("rejects reuse of one idempotency key with a different payload", async () => {
  const executor = createIdempotentToolExecutor({ store: createMemoryCheckpointStore() });
  const base = { idempotencyKey: "same-key", toolId: "send_message", execute: async () => ({ ok: true }) };
  assert.equal((await executor.execute({ ...base, arguments: { value: 1 } })).ok, true);
  assert.equal((await executor.execute({ ...base, arguments: { value: 2 } })).code, "IDEMPOTENCY_KEY_CONFLICT");
});

test("unknown effect outcome is paused and never executed a second time", async () => {
  const executor = createIdempotentToolExecutor({ store: createMemoryCheckpointStore() });
  let calls = 0;
  const request = { idempotencyKey: "uncertain-key", toolId: "send_message", arguments: { value: 1 },
    execute: async () => { calls++; throw new Error("connection lost"); } };
  assert.equal((await executor.execute(request)).code, "EFFECT_OUTCOME_UNKNOWN");
  assert.equal((await executor.execute(request)).code, "EFFECT_OUTCOME_UNKNOWN");
  assert.equal(calls, 1);
});

test("tool registry requires a durable executor for idempotent side-effect tools", () => {
  const tool = { id: "send_message", description: "Sends a message.", idempotencyMode: "downstream_key",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async () => ({ sent: true }) };
  assert.throws(() => createToolRegistry({ tools: [tool], enabled: true }), /IDEMPOTENT_EXECUTOR_REQUIRED/);
});

test("tool registry forwards stable idempotency keys to downstream handlers", async () => {
  const executor = createIdempotentToolExecutor({ store: createMemoryCheckpointStore() });
  let forwarded;
  const registry = createToolRegistry({ enabled: true, idempotentExecutor: executor,
    tools: [{ id: "send_message", description: "Sends a message.", idempotencyMode: "downstream_key",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (_args, context) => { forwarded = context.idempotencyKey; return { sent: true }; } }] });
  const result = await registry.execute("send_message", {}, {
    allowToolExecution: true, allowedToolIds: ["send_message"], session: createToolSession(), idempotencyKey: "run-1:1:send_message",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { sent: true });
  assert.match(forwarded, /^tool_[a-f0-9]{64}:execute_tool$/);
});


test("Cloudflare executor requires the durable workflow binding", () => {
  assert.throws(() => createCloudflareIdempotentToolExecutor({ env: {} }), /WORKFLOW_TASKS_BINDING_REQUIRED/);
});
