import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry, createToolSession } from "../src/agent/tool-registry.mjs";
import { createSkillRegistry } from "../src/agent/skill-registry.mjs";
const schema = { type: "object", properties: { query: { type: "string", maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 5 } }, required: ["query"], additionalProperties: false };
const session = (maxCalls = 4) => createToolSession({ maxCalls });
const make = (opts = {}) => createToolRegistry({ tools: [{ id: "local_lookup", description: "Local fixture lookup.", inputSchema: schema, handler: async ({ query, limit = 5 }) => ({ query, limit }) }], ...opts });

test("disabled by default; listing never executes handlers", async () => {
  let calls = 0;
  const r = createToolRegistry({ tools: [{ id: "safe_tool", description: "Fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async () => { calls++; return {}; } }] });
  assert.equal(r.enabled, false); assert.equal(r.list().length, 1); assert.ok(r.get("safe_tool")); assert.equal(calls, 0);
  assert.equal((await r.execute("safe_tool", {}, { allowToolExecution: true })).code, "TOOLS_DISABLED"); assert.equal(calls, 0);
});
test("explicit approval and capability allowlist are required", async () => {
  const r = make({ enabled: true });
  assert.equal((await r.execute("local_lookup", { query: "x" })).code, "EXECUTION_NOT_APPROVED");
  assert.equal((await r.execute("local_lookup", { query: "x" }, { allowToolExecution: true, allowedToolIds: [] })).code, "TOOL_CAPABILITY_DENIED");
  assert.deepEqual(await r.execute("local_lookup", { query: "x" }, { allowToolExecution: true, allowedToolIds: ["local_lookup"], session: session() }), { ok: true, result: { query: "x", limit: 5 }, calls: 1, sessionCalls: 1 });
});
test("unknown tool and invalid arguments never call handler", async () => {
  let calls = 0; const r = createToolRegistry({ enabled: true, tools: [{ id: "local_lookup", description: "Fixture.", inputSchema: schema, handler: async () => { calls++; return {}; } }] });
  const ctx = { allowToolExecution: true, allowedToolIds: ["local_lookup"], session: session() };
  assert.equal((await r.execute("missing", {}, ctx)).code, "TOOL_NOT_FOUND");
  for (const v of [{}, { query: "x", extra: true }, { query: 4 }, { query: "x".repeat(101) }, { query: "x", limit: 6 }, { query: "x", limit: 1.5 }]) assert.equal(r.validate("local_lookup", v).ok, false);
  assert.equal(calls, 0);
});
test("registry-owned per-tool call limit cannot be reset by caller state", async () => {
  const r = make({ enabled: true, limits: { maxCalls: 1 } }); const ctx = { allowToolExecution: true, allowedToolIds: ["local_lookup"], session: session() };
  assert.equal((await r.execute("local_lookup", { query: "x" }, ctx, { calls: 0 })).ok, true);
  assert.equal((await r.execute("local_lookup", { query: "x" }, ctx, { calls: 0 })).code, "TOOL_CALL_LIMIT");
});
test("timeout aborts signal and returns stable code", async () => {
  let observedAbort = false;
  const r = createToolRegistry({ enabled: true, limits: { timeoutMs: 10 }, tools: [{ id: "slow_tool", description: "Slow fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async (_a, { signal }) => new Promise((resolve) => signal.addEventListener("abort", () => { observedAbort = true; resolve("late"); }, { once: true })) }] });
  assert.equal((await r.execute("slow_tool", {}, { allowToolExecution: true, allowedToolIds: ["slow_tool"], session: session() })).code, "TOOL_TIMEOUT");
  assert.equal(observedAbort, true);
});
test("timeout returns even if handler ignores abort", async () => {
  const r = createToolRegistry({ enabled: true, limits: { timeoutMs: 10 }, tools: [{ id: "hung_tool", description: "Never settles.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async () => new Promise(() => {}) }] });
  assert.equal((await r.execute("hung_tool", {}, { allowToolExecution: true, allowedToolIds: ["hung_tool"], session: session() })).code, "TOOL_TIMEOUT");
});
test("late rejection after timeout does not become an unhandled rejection", async () => {
  const r = createToolRegistry({ enabled: true, limits: { timeoutMs: 10 }, tools: [{ id: "late_error", description: "Late error fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async (_a, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("secret=late-token")), { once: true })) }] });
  assert.equal((await r.execute("late_error", {}, { allowToolExecution: true, allowedToolIds: ["late_error"], session: session() })).code, "TOOL_TIMEOUT");
});
test("oversized outputs and thrown secret-bearing errors are sanitized", async () => {
  const r = createToolRegistry({ enabled: true, limits: { maxOutputBytes: 10 }, tools: [{ id: "big_tool", description: "Large fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async () => ({ text: "too large to fit" }) }, { id: "error_tool", description: "Error fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, handler: async () => { throw new Error("api_key=secret-value"); } }] });
  const ctx = { allowToolExecution: true, allowedToolIds: ["big_tool", "error_tool"], session: session() };
  assert.equal((await r.execute("big_tool", {}, ctx)).code, "TOOL_OUTPUT_TOO_LARGE");
  const e = await r.execute("error_tool", {}, ctx); assert.equal(e.code, "TOOL_EXECUTION_FAILED"); assert.equal(JSON.stringify(e).includes("secret-value"), false);
});
test("unsafe schemas, duplicate IDs and invalid limits are rejected", () => {
  const tool = { id: "local_lookup", description: "Fixture.", inputSchema: schema, handler: async () => ({}) };
  assert.throws(() => createToolRegistry({ tools: [tool, tool] }), /DUPLICATE_TOOL/);
  assert.throws(() => createToolRegistry({ tools: [{ ...tool, inputSchema: { type: "object", properties: { x: { type: "string" } } } } ] }), /INVALID_TOOL_SCHEMA/);
  assert.throws(() => createToolRegistry({ limits: { maxCalls: 0 } }), /INVALID_LIMIT/);
});
test("rejects unknown schema keywords and duplicate required fields", () => {
  const base = { id: "safe_tool", description: "Schema fixture.", inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 20 } }, required: ["query"], additionalProperties: false }, handler: async () => "ok" };
  assert.throws(() => createToolRegistry({ tools: [{ ...base, inputSchema: { ...base.inputSchema, pattern: ".*" } }] }), /INVALID_TOOL_SCHEMA/);
  assert.throws(() => createToolRegistry({ tools: [{ ...base, inputSchema: { ...base.inputSchema, required: ["query", "query"] } }] }), /INVALID_TOOL_SCHEMA/);
  assert.throws(() => createToolRegistry({ tools: [{ ...base, inputSchema: { type: "object", properties: { query: { type: "string", minimum: 0 } }, additionalProperties: false } }] }), /INVALID_TOOL_SCHEMA/);
});
test("skills only declare registered capabilities", () => {
  const tools = make(); const skills = createSkillRegistry({ toolRegistry: tools, skills: [{ id: "research_plan", version: "1.0.0", description: "Plan a bounded research task.", allowedToolIds: ["local_lookup"] }] });
  assert.equal(skills.allows("research_plan", "local_lookup"), true); assert.equal(skills.allows("research_plan", "missing"), false);
  assert.throws(() => createSkillRegistry({ toolRegistry: tools, skills: [{ id: "bad_skill", version: "1.0.0", description: "Invalid.", allowedToolIds: ["missing"] }] }), /UNKNOWN_SKILL_TOOL/);
  assert.throws(() => createSkillRegistry({ toolRegistry: tools, skills: [{ id: "bad_skill", version: "1.0.0", description: "Duplicate.", allowedToolIds: ["local_lookup", "local_lookup"] }] }), /DUPLICATE_SKILL_TOOL/);
});
