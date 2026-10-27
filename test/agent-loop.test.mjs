import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../src/agent/tool-registry.mjs";
import { createSkillRegistry } from "../src/agent/skill-registry.mjs";
import { createAgentLoop, createAgentBudget } from "../src/agent/agent-loop.mjs";
import { createAgentAuditLog } from "../src/agent/audit-log.mjs";
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
test("rejects oversized or non-serializable initial planner context", async () => {
  const { loop } = setup();
  assert.equal((await loop.run({ skillId: "safe_research", input: "x".repeat(9000), allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async () => ({ type: "final", output: "ok" }) })).code, "INPUT_TOO_LARGE_OR_INVALID");
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal((await loop.run({ skillId: "safe_research", input: cyclic, allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async () => ({ type: "final", output: "ok" }) })).code, "INPUT_TOO_LARGE_OR_INVALID");
});
test("bounds accumulated planner context after tool results", async () => {
  const toolRegistry = createToolRegistry({ enabled: true, tools: [{ id: "local_echo", description: "Large result fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async () => "z".repeat(7000) }] });
  const skillRegistry = createSkillRegistry({ toolRegistry, skills: [{ id: "safe_research", version: "1.0.0", description: "Bounded fixture.", allowedToolIds: ["local_echo"] }] });
  const loop = createAgentLoop({ toolRegistry, skillRegistry, maxSteps: 3, maxToolCalls: 2 });
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async () => ({ type: "tool", toolId: "local_echo", arguments: {} }) });
  assert.equal(result.code, "AGENT_CONTEXT_TOO_LARGE");
});
test("invalid budget and unsafe limit settings are rejected", async () => {
  const { loop } = setup();
  assert.equal((await runArgs(loop, async () => ({ type: "final", output: "ok" }), { budget: {} })).code, "INVALID_AGENT_BUDGET");
  assert.throws(() => createAgentBudget({ maxToolCalls: 99 }), /INVALID_BUDGET_LIMIT/);
  assert.throws(() => createAgentLoop({ toolRegistry: {}, skillRegistry: {}, maxSteps: 99 }), /TOOL_REGISTRY_REQUIRED/);
});

test("independent agent budgets do not exhaust each other", async () => {
  const { loop, getExecutions } = setup({ maxSteps: 2, maxToolCalls: 1 });
  const firstBudget = createAgentBudget({ maxToolCalls: 1 });
  const secondBudget = createAgentBudget({ maxToolCalls: 1 });
  const plan = async ({ step }) => step === 1
    ? ({ type: "tool", toolId: "local_echo", arguments: { value: "isolated" } })
    : ({ type: "final", output: "done" });
  const [first, second] = await Promise.all([
    runArgs(loop, plan, { budget: firstBudget }),
    runArgs(loop, plan, { budget: secondBudget }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.budgetUsed, 1);
  assert.equal(second.budgetUsed, 1);
  assert.equal(getExecutions(), 2);
});

test("failed tool execution still consumes shared budget", async () => {
  const { loop } = setup({ executeOverride: async () => ({ ok: false, code: "TOOL_TIMEOUT" }) });
  const budget = createAgentBudget({ maxToolCalls: 1 });
  const toolPlan = async () => ({ type: "tool", toolId: "local_echo", arguments: { value: "x" } });
  const first = await runArgs(loop, toolPlan, { budget });
  assert.equal(first.code, "TOOL_TIMEOUT");
  assert.equal(first.toolCalls, 0);
  const second = await runArgs(loop, toolPlan, { budget });
  assert.equal(second.code, "AGENT_SHARED_BUDGET_EXHAUSTED");
  assert.equal(second.toolCalls, 0);
});

test("agent loop records privacy-safe audit events on successful runs", async () => {
  const auditLog = createAgentAuditLog({ now: () => 10 });
  const registry = createToolRegistry({ enabled: true, tools: [{ id: "local_echo", description: "safe fixture", inputSchema: { type: "object", properties: { value: { type: "string", maxLength: 40 } }, required: ["value"], additionalProperties: false }, handler: async () => "ok" }] });
  const skills = createSkillRegistry({ toolRegistry: registry, skills: [{ id: "safe_research", version: "1.0.0", description: "fixture", allowedToolIds: ["local_echo"] }] });
  const loop = createAgentLoop({ toolRegistry: registry, skillRegistry: skills, auditLog });
  const result = await runArgs(loop, async ({ step }) => step === 1 ? ({ type: "tool", toolId: "local_echo", arguments: { value: "do not log this" } }) : ({ type: "final", output: "done" }), { runId: "audit_run_1" });
  assert.equal(result.ok, true);
  assert.deepEqual(auditLog.list({ runId: "audit_run_1" }).map(e => e.type), ["run_started", "tool_reserved", "tool_succeeded", "run_succeeded"]);
  assert.equal(JSON.stringify(auditLog.list()).includes("do not log this"), false);
});

test("agent loop audit records sanitized tool failures", async () => {
  const auditLog = createAgentAuditLog({ now: () => 11 });
  const { loop: base } = setup({ executeOverride: async () => ({ ok: false, code: "TOOL_TIMEOUT" }) });
  const loop = createAgentLoop({
    toolRegistry: { execute: base ? async () => ({ ok: false, code: "TOOL_TIMEOUT" }) : null, get: () => ({ id: "local_echo" }) },
    skillRegistry: { allows: () => true, get: () => ({ allowedToolIds: ["local_echo"] }) },
    auditLog,
  });
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: ["local_echo"], plan: async () => ({ type: "tool", toolId: "local_echo", arguments: {} }), runId: "audit_fail_1" });
  assert.equal(result.code, "TOOL_TIMEOUT");
  assert.deepEqual(auditLog.list({ runId: "audit_fail_1" }).map(e => e.type), ["run_started", "tool_reserved", "tool_failed", "run_failed"]);
});

test("audit logger exceptions do not interrupt agent runs", async () => {
  const registry = createToolRegistry({ enabled: true, tools: [] });
  const skills = createSkillRegistry({ toolRegistry: registry, skills: [{ id: "safe_research", version: "1.0.0", description: "fixture", allowedToolIds: [] }] });
  const loop = createAgentLoop({ toolRegistry: registry, skillRegistry: skills, auditLog: { record() { throw new Error("private"); } } });
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: [], plan: async () => ({ type: "final", output: "ok" }) });
  assert.equal(result.ok, true);
});

test("audit log records sanitized planner failures", async () => {
  const auditLog = createAgentAuditLog({ now: () => 12 });
  const { loop: original } = setup();
  const registry = createToolRegistry({ enabled: true, tools: [] });
  const skills = createSkillRegistry({ toolRegistry: registry, skills: [{ id: "safe_research", version: "1.0.0", description: "fixture", allowedToolIds: [] }] });
  const loop = createAgentLoop({ toolRegistry: registry, skillRegistry: skills, auditLog });
  const result = await loop.run({ skillId: "safe_research", input: {}, allowToolExecution: true, allowedToolIds: [], plan: async () => { throw new Error("prompt=private"); }, runId: "planner_fail_1" });
  assert.equal(result.code, "PLANNER_FAILED");
  assert.deepEqual(auditLog.list({ runId: "planner_fail_1" }).map(e => [e.type, e.code]), [["run_started", undefined], ["run_failed", "PLANNER_FAILED"]]);
  assert.equal(JSON.stringify(auditLog.list()).includes("prompt=private"), false);
});
