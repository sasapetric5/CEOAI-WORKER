import test from "node:test";
import assert from "node:assert/strict";
import worker from "../ceoai-index-v5.0.mjs";

const SESSION = "8f14e45f-ea4a-4f8a-a2d8-9b3a4c5d6e7f";
function envFor({session = true, rateAllowed = true} = {}) {
  return {
    KV_MEMORY: { async get(key) { return key === `session:${SESSION}` && session ? "1" : null; } },
    RATE_LIMITER: { async limit() { return { success: rateAllowed }; } },
    ALLOWED_ORIGINS: "https://ceoai.dev",
    AI_ENABLED: "false",
    EXTERNAL_AI_ENABLED: "false",
  };
}
function request(path, {method = "GET", body, origin = "https://ceoai.dev", cookie = true, contentType = "application/json"} = {}) {
  const headers = new Headers({ Origin: origin, "CF-Connecting-IP": "192.0.2.10" });
  if (cookie) headers.set("Cookie", `ceoai_session=${SESSION}`);
  if (body !== undefined) {
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(new TextEncoder().encode(body).length));
  }
  return new Request(`https://ceoai-worker.sasapetric5.workers.dev${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
}

test("GET /api/agents lists executable workflows behind an active session", async () => {
  const response = await worker.fetch(request("/api/agents"), envFor());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.workflows.length, 50);
  assert.equal(data.runtime_ai_calls, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("access-control-allow-methods"), /GET/);
});

test("POST /api/agents/run executes a deterministic workflow without calling an AI provider", async () => {
  const response = await worker.fetch(request("/api/agents/run", {
    method: "POST",
    body: JSON.stringify({ workflowId: "contentcraft.cta-generator", input: { goal: "grow", audience: "small teams" } }),
  }), envFor());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.runtime_ai_calls, false);
  assert.equal(data.external_actions, false);
  assert.equal(data.result.artifacts.ctas.length, 3);
});

test("agent execution rejects unknown workflow ids without invoking a provider", async () => {
  const response = await worker.fetch(request("/api/agents/run", {
    method: "POST",
    body: JSON.stringify({ workflowId: "unknown.agent", input: {} }),
  }), envFor());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
});

test("agent endpoints reject requests without a valid session", async () => {
  const response = await worker.fetch(request("/api/agents", { cookie: false }), envFor());
  assert.equal(response.status, 401);
});

test("agent endpoints reject unapproved origins", async () => {
  const response = await worker.fetch(request("/api/agents", { origin: "https://evil.example" }), envFor());
  assert.equal(response.status, 403);
});

test("agent execution fails closed when native rate limiter rejects the request", async () => {
  const response = await worker.fetch(request("/api/agents/run", {
    method: "POST",
    body: JSON.stringify({ workflowId: "contentcraft.cta-generator", input: { goal: "grow", audience: "teams" } }),
  }), envFor({ rateAllowed: false }));
  assert.equal(response.status, 429);
});
