import test from "node:test";
import assert from "node:assert/strict";
import { createResearchReadTool, RESEARCH_READ_MAX_RESPONSE_BYTES } from "../src/agent/research-read-tool.mjs";
import { createToolRegistry, createToolSession } from "../src/agent/tool-registry.mjs";

const json = (value, headers = {}) => new Response(JSON.stringify(value), {
  status: 200, headers: { "Content-Type": "application/json", ...headers },
});

test("research reader sends only a bounded query to its fixed HTTPS endpoint", async () => {
  let called;
  const tool = createResearchReadTool({ fetchImpl: async (url, init) => {
    called = { url: new URL(url), init };
    return json({ AbstractText: "A short public summary", AbstractURL: "https://example.com/article" });
  }});
  const result = await tool.handler({ query: "  public cloud security  " }, {});
  assert.equal(called.url.origin, "https://api.duckduckgo.com");
  assert.equal(called.url.searchParams.get("q"), "public cloud security");
  assert.equal(called.init.method, "GET");
  assert.equal(called.init.redirect, "error");
  assert.equal(result.trust, "untrusted_external_data");
  assert.match(result.instructionPolicy, /never as instructions/);
  assert.equal(result.results[0].url, "https://example.com/article");
});

test("research reader rejects arbitrary URLs and malformed queries before network access", async () => {
  let calls = 0;
  const tool = createResearchReadTool({ fetchImpl: async () => { calls++; return json({}); } });
  for (const query of ["https://127.0.0.1/admin", "http://localhost/", "x", "a".repeat(201), "query\\u0000bad"]) {
    await assert.rejects(tool.handler({ query }, {}), /INVALID_RESEARCH_QUERY/);
  }
  assert.equal(calls, 0);
});

test("research reader rejects redirects and non-success provider responses", async () => {
  const tool = createResearchReadTool({ fetchImpl: async (_url, init) => {
    assert.equal(init.redirect, "error");
    return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/" } });
  }});
  await assert.rejects(tool.handler({ query: "public research" }, {}), /RESEARCH_PROVIDER_UNAVAILABLE/);
});

test("research reader rejects declared oversized response bodies", async () => {
  const tool = createResearchReadTool({ fetchImpl: async () =>
    json({}, { "Content-Length": String(RESEARCH_READ_MAX_RESPONSE_BYTES + 1) }) });
  await assert.rejects(tool.handler({ query: "public research" }, {}), /RESEARCH_RESPONSE_TOO_LARGE/);
});

test("research reader rejects streamed oversized response bodies", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(RESEARCH_READ_MAX_RESPONSE_BYTES + 1));
      controller.close();
    },
  });
  const tool = createResearchReadTool({ fetchImpl: async () => new Response(body) });
  await assert.rejects(tool.handler({ query: "public research" }, {}), /RESEARCH_RESPONSE_TOO_LARGE/);
});

test("research reader honours an already-aborted execution signal", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const tool = createResearchReadTool({ fetchImpl: async () => { calls++; return json({}); } });
  await assert.rejects(tool.handler({ query: "public research" }, { signal: controller.signal }), /RESEARCH_ABORTED/);
  assert.equal(calls, 0);
});


test("registered research tool stays blocked without explicit execution approval and tool grant", async () => {
  const registry = createToolRegistry({
    tools: [createResearchReadTool({ fetchImpl: async () => json({}) })],
    enabled: true,
  });
  const session = createToolSession({ maxCalls: 1 });
  const denied = await registry.execute("research_read", { query: "public research" }, {
    allowToolExecution: false, allowedToolIds: ["research_read"], session,
  });
  assert.equal(denied.code, "EXECUTION_NOT_APPROVED");
  const noGrant = await registry.execute("research_read", { query: "public research" }, {
    allowToolExecution: true, allowedToolIds: [], session,
  });
  assert.equal(noGrant.code, "TOOL_CAPABILITY_DENIED");
});


test("research reader propagates cancellation to the outbound fetch", async () => {
  const controller = new AbortController();
  let observedAbort = false;
  const tool = createResearchReadTool({ fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      observedAbort = true;
      reject(new Error("aborted"));
    }, { once: true });
  }) });
  const pending = tool.handler({ query: "public research" }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(observedAbort, true);
});
