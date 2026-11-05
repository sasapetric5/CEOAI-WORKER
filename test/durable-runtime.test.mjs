import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareDurableExecutionEngine } from "../src/agent/cloudflare-durable-runtime.mjs";

test("requires the production Durable Object binding and never silently uses memory", () => {
  assert.throws(() => createCloudflareDurableExecutionEngine({
    env: {}, executeStep: async () => ({ ok: true }),
  }), /WORKFLOW_TASKS_BINDING_REQUIRED/);
});

test("requires an explicit approved step executor", () => {
  assert.throws(() => createCloudflareDurableExecutionEngine({
    env: { WORKFLOW_TASKS: { idFromName() {}, get() {} } },
  }), /STEP_EXECUTOR_REQUIRED/);
});

test("wires the Cloudflare Durable Object adapter into the fenced engine", () => {
  const namespace = { idFromName: id => id, get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true, lease: { ownerToken: "x", fencingToken: 1 } })) }) };
  const engine = createCloudflareDurableExecutionEngine({
    env: { WORKFLOW_TASKS: namespace },
    executeStep: async () => ({ ok: true }),
  });
  for (const method of ["create", "run", "get", "decideApproval", "cancel"]) {
    assert.equal(typeof engine[method], "function");
  }
});
