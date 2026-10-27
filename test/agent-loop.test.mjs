import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../src/agent/tool-registry.mjs";
import { createSkillRegistry } from "../src/agent/skill-registry.mjs";
import { createAgentLoop } from "../src/agent/agent-loop.mjs";

function setup({ maxSteps = 4, maxToolCalls = 2 } = {}) {
  let executions = 0;
  const toolRegistry = createToolRegistry({ enabled: true, tools: [{ id: "local_echo", description: "Returns a local test value.", inputSchema: { type: "object", properties: { value: { type: "string", maxLength: 40 } }, required: ["value"], additionalProperties: false }, handler: async ({ value }) => { executions++; return { value }; } }] });
  const skillRegistry = createSkillRegistry({ toolRegistry, skills: [{ id: "safe_research", version: "1.0.0", description: "Bounded local research fixture.", allowedToolIds: ["local_echo"] }] });
  return { loop: createAgentLoop({ toolRegistry, skillRegistry, maxSteps, maxToolCalls }), getExecutions: () => executions };
}

test("requires explicit approval and known skill", async () => {
  const { loop } = setup();
  assert.equal((await loop.run({ skillId: "safe_research", input: {}, plan: async () => ({ type: "final", output: "ok" }) })).code, "EXECUTION_NOT_APPROVED");
  assert.equal((await loop.run({ skillId: "missing", input: {}, allowToolExecution: true, plan: async () => ({ type: "final", output: "ok" }) })).code, "SKILL_NOT_FOUND");
});
test("returns final output without calling tools", async () => {
  const { loop, getExecutions } = setup();
  assert.deepEqual(await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async () => ({ type: "final", output: "done" }) }), { ok: true, output: "done", steps: 1, toolCalls: 0 });
  assert.equal(getExecutions(), 0);
});
test("uses only skill and caller allowlisted tools", async () => {
  const { loop, getExecutions } = setup();
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async ({ step }) => step === 1 ? ({ type: "tool", toolId: "local_echo", arguments: { value: "safe" } }) : ({ type: "final", output: "finished" }) });
  assert.deepEqual(result, { ok: true, output: "finished", steps: 2, toolCalls: 1 });
  assert.equal(getExecutions(), 1);
});
test("denies tools outside caller capability allowlist", async () => {
  const { loop, getExecutions } = setup();
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: [], plan: async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } }) });
  assert.equal(result.code, "TOOL_CAPABILITY_DENIED");
  assert.equal(getExecutions(), 0);
});
test("stops after maximum tool calls", async () => {
  const { loop, getExecutions } = setup({ maxSteps: 4, maxToolCalls: 1 });
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } }) });
  assert.equal(result.code, "AGENT_TOOL_CALL_LIMIT");
  assert.equal(result.toolCalls, 1);
  assert.equal(getExecutions(), 1);
});
test("planner errors and malformed decisions fail closed", async () => {
  const { loop } = setup();
  const args = { skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"] };
  assert.equal((await loop.run({ ...args, plan: async () => { throw new Error("failure"); } })).code, "PLANNER_FAILED");
  assert.equal((await loop.run({ ...args, plan: async () => ({ type: "unknown" }) })).code, "INVALID_PLAN");
});
test("rejects oversized final output", async () => {
  const { loop } = setup();
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async () => ({ type: "final", output: "x".repeat(9000) }) });
  assert.equal(result.code, "INVALID_FINAL_OUTPUT");
});
