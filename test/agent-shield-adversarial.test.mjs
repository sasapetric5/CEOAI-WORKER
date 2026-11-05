import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry, createToolSession } from "../src/agent/tool-registry.mjs";

function fixture() {
  let calls = 0;
  const registry = createToolRegistry({
    enabled: true,
    tools: [{
      id: "safe_lookup",
      description: "Bounded local security fixture.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => { calls++; return { ok: true }; },
    }],
  });
  return { registry, calls: () => calls };
}
const context = (overrides = {}) => ({
  allowToolExecution: true,
  allowedToolIds: ["safe_lookup"],
  session: createToolSession(),
  ...overrides,
});

test("tool execution requires an explicit own caller grant", async () => {
  const { registry, calls } = fixture();
  const result = await registry.execute("safe_lookup", {}, {
    allowToolExecution: true,
    session: createToolSession(),
  });
  assert.equal(result.code, "TOOL_CAPABILITY_DENIED");
  assert.equal(calls(), 0);
});

test("inherited tool grants cannot authorize execution", async () => {
  const { registry, calls } = fixture();
  const inherited = Object.create({ allowedToolIds: ["safe_lookup"] });
  inherited.allowToolExecution = true;
  inherited.session = createToolSession();
  const result = await registry.execute("safe_lookup", {}, inherited);
  assert.equal(result.code, "INVALID_EXECUTION_CONTEXT");
  assert.equal(calls(), 0);
});

test("accessor-backed approvals and grants are rejected without invoking getters", async () => {
  const { registry, calls } = fixture();
  let getterCalls = 0;
  const supplied = { session: createToolSession() };
  Object.defineProperty(supplied, "allowToolExecution", {
    enumerable: true, get() { getterCalls++; return true; },
  });
  Object.defineProperty(supplied, "allowedToolIds", {
    enumerable: true, get() { getterCalls++; return ["safe_lookup"]; },
  });
  const result = await registry.execute("safe_lookup", {}, supplied);
  assert.equal(result.code, "EXECUTION_NOT_APPROVED");
  assert.equal(getterCalls, 0);
  assert.equal(calls(), 0);
});

test("malformed, oversized and unapproved capability lists fail closed", async () => {
  const { registry, calls } = fixture();
  const cases = [
    { allowedToolIds: "safe_lookup" },
    { allowedToolIds: Array(33).fill("safe_lookup") },
    { allowedToolIds: ["other_tool"] },
  ];
  for (const grants of cases) {
    const result = await registry.execute("safe_lookup", {}, context(grants));
    assert.equal(result.code, "TOOL_CAPABILITY_DENIED");
  }
  assert.equal(calls(), 0);
});

test("only an explicitly approved tool with a valid session executes", async () => {
  const { registry, calls } = fixture();
  const result = await registry.execute("safe_lookup", {}, context());
  assert.equal(result.ok, true);
  assert.equal(calls(), 1);
});

test("skill-like metadata cannot replace the code-owned execution allowlist", async () => {
  const { registry, calls } = fixture();
  const maliciousMetadata = {
    allowToolExecution: true,
    allowedToolIds: ["safe_lookup", "shell", "network_fetch", "read_secrets"],
    session: createToolSession(),
    capabilities: ["shell", "network_fetch", "read_secrets"],
  };
  const result = await registry.execute("shell", {}, maliciousMetadata);
  assert.equal(result.code, "TOOL_NOT_FOUND");
  assert.equal(calls(), 0);
});

test("accessor-backed session tokens are rejected without invoking getters", async () => {
  const { registry, calls } = fixture();
  let getterCalls = 0;
  const supplied = { allowToolExecution: true, allowedToolIds: ["safe_lookup"] };
  Object.defineProperty(supplied, "session", {
    enumerable: true, get() { getterCalls++; return createToolSession(); },
  });
  const result = await registry.execute("safe_lookup", {}, supplied);
  assert.equal(result.code, "INVALID_TOOL_SESSION");
  assert.equal(getterCalls, 0);
  assert.equal(calls(), 0);
});
