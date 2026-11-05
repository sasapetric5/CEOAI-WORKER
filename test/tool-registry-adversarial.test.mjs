import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../src/agent/tool-registry.mjs";

test("tool argument accessors and symbol properties are rejected without getter execution", () => {
  let getterCalls = 0;
  const input = {};
  Object.defineProperty(input, "term", { enumerable: true, get() { getterCalls++; return "unsafe"; } });
  const registry = createToolRegistry({ tools: [{
    id: "safe_lookup", description: "Test lookup",
    inputSchema: { type: "object", properties: { term: { type: "string", maxLength: 20 } }, required: ["term"], additionalProperties: false },
    handler: async () => ({ ok: true })
  }]});
  assert.equal(registry.validate("safe_lookup", input).code, "INVALID_ARGUMENTS");
  assert.equal(getterCalls, 0);
  const symbolInput = { term: "safe" };
  symbolInput[Symbol("hidden")] = "unexpected";
  assert.equal(registry.validate("safe_lookup", symbolInput).code, "UNKNOWN_ARGUMENT");
});

test("tool execution does not invoke getters hidden in execution state", async () => {
  let getterCalls = 0;
  let handlerCalls = 0;
  const registry = createToolRegistry({ enabled: true, tools: [{
    id: "safe_lookup", description: "Test lookup",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => { handlerCalls++; return { ok: true }; }
  }]});
  const { createToolSession } = await import("../src/agent/tool-registry.mjs");
  const context = { allowToolExecution: true, allowedToolIds: ["safe_lookup"] };
  Object.defineProperty(context, "session", { enumerable: true, get() { getterCalls++; return createToolSession(); } });
  const result = await registry.execute("safe_lookup", {}, context);
  assert.equal(result.code, "INVALID_TOOL_SESSION");
  assert.equal(getterCalls, 0);
  assert.equal(handlerCalls, 0);
});
