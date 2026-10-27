import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../src/agent/tool-registry.mjs";
import { createSkillRegistry } from "../src/agent/skill-registry.mjs";
import { createAgentLoop, createAgentBudget } from "../src/agent/agent-loop.mjs";
function setup({ maxSteps = 4, maxToolCalls = 2, executeOverride } = {}) {
  let executions = 0;
  const base = createToolRegistry({ enabled: true, tools: [{ id: "local_echo", description: "Returns a local test value.", inputSchema: { type: "object", properties: { value: { type: "string", maxLength: 40 } }, required: ["value"], additionalProperties: false }, handler: async ({ value }) => { executions++; return { value }; } }] });
  const toolRegistry = executeOverride ? { ...base, execute: executeOverride, get: base.get } : base;
  const skillRegistry = createSkillRegistry({ toolRegistry: base, skills: [{ id: "safe_research", version: "1.0.0", description: "Bounded local research fixture.", allowedToolIds: ["local_echo"] }] });
  return { loop: createAgentLoop({ toolRegistry, skillRegistry, maxSteps, maxToolCalls }), getExecutions: () => executions };
}
const runArgs = (loop, plan, extra = {}) => loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"], plan, ...extra });
test("requires explicit approval and known skill", async () => {
  const { loop } = setup();
  assert.equal((await loop.run({ skillId: "safe_research", input: {}, plan: async () => ({ type: "final", output: "ok" }) })).code, "EXECUTION_NOT_APPROVED");
  assert.equal((await loop.run({ skillId: "missing", input: {}, allowToolExecution: true, plan: async () => ({ type: "final", output: "ok" }) })).code, "SKILL_NOT_FOUND");
});
test("returns final output without calling tools", async () => {
  const { loop, getExecutions } = setup();
  assert.deepEqual(await runArgs(loop, async () => ({ type: "final", output: "done" })), { ok: true, output: "done", steps: 1, toolCalls: 0, budgetUsed: 0 });
  assert.equal(getExecutions(), 0);
});
test("uses only skill and caller allowlisted tools", async () => {
  const { loop, getExecutions } = setup();
  const result = await runArgs(loop, async ({ step }) => step === 1 ? ({ type: "tool", toolId: "local_echo", arguments: { value: "safe" } }) : ({ type: "final", output: "finished" }));
  assert.deepEqual(result, { ok: true, output: "finished", steps: 2, toolCalls: 1, budgetUsed: 1 });
  assert.equal(getExecutions(), 1);
});
test("denies tools outside caller capability allowlist", async () => {
  const { loop, getExecutions } = setup();
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: [], plan: async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } }) });
  assert.equal(result.code, "TOOL_CAPABILITY_DENIED");
  assert.equal(getExecutions(), 0);
});
test("stops after per-run tool call maximum", async () => {
  const { loop, getExecutions } = setup({ maxSteps: 4, maxToolCalls: 1 });
  const result = await runArgs(loop, async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } }));
  assert.equal(result.code, "AGENT_TOOL_CALL_LIMIT"); assert.equal(result.toolCalls, 1); assert.equal(getExecutions(), 1);
});
test("planner errors and malformed decisions fail closed", async () => {
  const { loop } = setup();
  assert.equal((await runArgs(loop, async () => { throw new Error("failure"); })).code, "PLANNER_FAILED");
  assert.equal((await runArgs(loop, async () => ({ type: "unknown" }))).code, "INVALID_PLAN");
});
test("rejects oversized final output", async () => {
  const { loop } = setup();
  assert.equal((await runArgs(loop, async () => ({ type: "final", output: "x".repeat(9000) }))).code, "INVALID_FINAL_OUTPUT");
});
test("shared budget prevents concurrent executions from overspending", async () => {
  const { loop, getExecutions } = setup({ maxSteps: 2, maxToolCalls: 2 });
  const budget = createAgentBudget({ maxToolCalls: 1 });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const first = runArgs(loop, async ({ step }) => { if (step === 1) await gate; return { type: "tool", toolId: "local_echo", arguments: { value: "x" } }; }, { budget });
  await Promise.resolve();
  const second = runArgs(loop, async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } }), { budget });
  release();
  const results = await Promise.all([first, second]);
  assert.ok(results.some(r => r.code === "AGENT_SHARED_BUDGET_EXHAUSTED"));
  assert.equal(results.filter(r => r.ok).length, 0);
  assert.equal(getExecutions(), 1);
});
test("executor rejection is sanitized and fails closed", async () => {
  const { loop } = setup({ executeOverride: async () => { throw new Error("token=secret"); } });
  const result = await runArgs(loop, async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } }));
  assert.equal(result.code, "TOOL_EXECUTION_FAILED");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("executor malformed result fails closed", async () => {
  const { loop } = setup({ executeOverride: async () => null });
  assert.equal((await runArgs(loop, async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } }))).code, "TOOL_EXECUTION_FAILED");
});
test("invalid budget and unsafe limit settings are rejected", async () => {
  const { loop } = setup();
  assert.equal((await runArgs(loop, async () => ({ type: "final", output: "ok" }), { budget: {} })).code, "INVALID_AGENT_BUDGET");
  assert.throws(() => createAgentBudget({ maxToolCalls: 99 }), /INVALID_BUDGET_LIMIT/);
  assert.throws(() => createAgentLoop({ toolRegistry: {}, skillRegistry: {}, maxSteps: 99 }), /TOOL_REGISTRY_REQUIRED/);
});
