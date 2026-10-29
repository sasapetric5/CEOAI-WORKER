import test from "node:test";
import assert from "node:assert/strict";
import worker from "../ceoai-index-v5.0.mjs";

class MemoryKV {
  constructor() { this.data = new Map(); }
  async get(key, type) {
    const value = this.data.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.data.set(key, String(value)); }
  async delete(key) { this.data.delete(key); }
}

function makeEnv(kv) {
  return {
    KV_MEMORY: kv,
    RATE_LIMITER: { async limit() { return { success: true }; } },
    AI_ENABLED: "true",
    EXTERNAL_AI_ENABLED: "true",
    OPENROUTER_FREE_CONFIRMED: "true",
    OPENROUTER_KEY: "test-openrouter-health",
  };
}

async function makeSession(env) {
  const response = await worker.fetch(new Request("https://ceoai.dev/", {
    headers: { Origin: "https://ceoai.dev" },
  }), env);
  assert.equal(response.status, 200);
  return response.headers.get("Set-Cookie")?.split(";")[0];
}

async function chat(env, cookie) {
  return worker.fetch(new Request("https://ceoai.dev/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://ceoai.dev",
      Cookie: cookie,
      "CF-Connecting-IP": "198.51.100.24",
    },
    body: JSON.stringify({ prompt: "Proveri pouzdanost provajdera" }),
  }), env);
}

test("chat success updates provider health without changing successful response", async () => {
  const kv = new MemoryKV();
  const env = makeEnv(kv);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /openrouter.ai/);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Odgovor iz testnog provajdera" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const cookie = await makeSession(env);
    const response = await chat(env, cookie);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.reply, "Odgovor iz testnog provajdera");
    // Agent handoffs are surfaced as metadata only: one model request, no separate agent executions.
    assert.equal(payload.stats.skillRouting.mode, "plan-only");
    assert.equal(payload.stats.skillRouting.handoffMode, "planned-only");
    assert.deepEqual(payload.stats.skillRouting.plannedAgents.map(agent => agent.id), [
      "research-agent", "qa-agent",
    ]);
    assert.ok(payload.stats.skillRouting.plannedAgents.every(agent =>
      agent.runtimeStatus === "plan-only" && agent.executionAllowed === false
    ));
    assert.equal(payload.stats.skillRouting.executionAllowed, false);
    const health = await kv.get("health:provider:openrouter-1", "json");
    assert.equal(health.status, "healthy");
    assert.equal(health.attempts, 1);
    assert.equal(health.successes, 1);
    assert.equal(health.failures, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("provider outage updates health and normal failover error remains controlled", async () => {
  const kv = new MemoryKV();
  const env = makeEnv(kv);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /openrouter.ai/);
    return new Response(JSON.stringify({ error: "temporary outage" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const cookie = await makeSession(env);
    const response = await chat(env, cookie);
    assert.equal(response.status, 503);
    const health = await kv.get("health:provider:openrouter-1", "json");
    assert.equal(health.status, "unavailable");
    assert.equal(health.attempts, 1);
    assert.equal(health.failures, 1);
    assert.equal(health.lastStatusCode, 503);
  } finally { globalThis.fetch = originalFetch; }
});


test("transient failure fails over and records privacy-safe recovery metrics", async () => {
  const kv = new MemoryKV();
  const env = {
    ...makeEnv(kv),
    GEMINI_FREE_CONFIRMED: "true",
    GEMINI_API_KEY_PRIMARY: "test-gemini-health",
  };
  const originalFetch = globalThis.fetch;
  const called = [];
  globalThis.fetch = async url => {
    const target = String(url);
    called.push(target);
    if (target.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
        status: 503, headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes("openrouter.ai")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Odgovor nakon uspešnog failover-a" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected provider endpoint in integration test");
  };
  try {
    const cookie = await makeSession(env);
    const response = await chat(env, cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Odgovor nakon uspešnog failover-a");
    assert.ok(called.some(url => url.includes("generativelanguage.googleapis.com")));
    assert.ok(called.some(url => url.includes("openrouter.ai")));
    const metrics = await kv.get("recovery:metrics:v1", "json");
    assert.equal(metrics.providerFailures, 1);
    assert.equal(metrics.failoverSuccesses, 1);
    assert.equal(metrics.recoveredRequests, 1);
    const failedHealth = await kv.get("health:provider:gemini-1", "json");
    const recoveredHealth = await kv.get("health:provider:openrouter-1", "json");
    assert.equal(failedHealth.lastFailureClass, "server_error");
    assert.equal(recoveredHealth.status, "healthy");
  } finally { globalThis.fetch = originalFetch; }
});


test("open circuit skips failed first provider and routes to the next healthy provider", async () => {
  const kv = new MemoryKV();
  const now = Date.now();
  kv.data.set("health:provider:gemini-1", JSON.stringify({
    provider: "gemini-1", status: "unavailable", attempts: 3, successes: 0, failures: 3,
    consecutiveFailures: 3, lastOutcomeAt: now - 1000, lastSuccessAt: null,
    lastFailureAt: now - 1000, lastStatusCode: 503, lastFailureClass: "server_error",
    updatedAt: now - 1000,
  }));
  const env = {
    ...makeEnv(kv), GEMINI_FREE_CONFIRMED: "true",
    GEMINI_API_KEY_PRIMARY: "test-gemini-circuit-open",
  };
  const originalFetch = globalThis.fetch;
  const called = [];
  globalThis.fetch = async url => {
    called.push(String(url));
    if (String(url).includes("openrouter.ai")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Odgovor rezervnog provajdera" } }] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("Open-circuit provider should not be called");
  };
  try {
    const cookie = await makeSession(env);
    const response = await chat(env, cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Odgovor rezervnog provajdera");
    assert.equal(called.length, 1);
    assert.ok(called[0].includes("openrouter.ai"));
    const metrics = await kv.get("recovery:metrics:v1", "json");
    assert.equal(metrics.circuitOpenSkips, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("active provider cooldown skips it and preserves healthy fallback", async () => {
  const kv = new MemoryKV();
  kv.data.set("cooldown:gemini-1", "1");
  const env = {
    ...makeEnv(kv), GEMINI_FREE_CONFIRMED: "true",
    GEMINI_API_KEY_PRIMARY: "test-gemini-cooldown",
  };
  const originalFetch = globalThis.fetch;
  const called = [];
  globalThis.fetch = async url => {
    called.push(String(url));
    if (String(url).includes("openrouter.ai")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Fallback posle cooldown-a" } }] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("Cooling-down provider should not be called");
  };
  try {
    const cookie = await makeSession(env);
    const response = await chat(env, cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, "Fallback posle cooldown-a");
    assert.equal(called.length, 1);
    assert.ok(called[0].includes("openrouter.ai"));
  } finally { globalThis.fetch = originalFetch; }
});

test("unavailable cooldown KV fails closed without leaking storage error or calling providers", async () => {
  const kv = new MemoryKV();
  const originalGet = kv.get.bind(kv);
  kv.get = async (key, type) => {
    if (String(key).startsWith("cooldown:")) throw new Error("private storage backend detail");
    return originalGet(key, type);
  };
  const env = {
    ...makeEnv(kv), GEMINI_FREE_CONFIRMED: "true",
    GEMINI_API_KEY_PRIMARY: "test-gemini-kv-down",
  };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return new Response("unexpected", { status: 200 });
  };
  try {
    const cookie = await makeSession(env);
    const response = await chat(env, cookie);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /privremenih ograničenja/);
    assert.equal(body.includes("private storage backend detail"), false);
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
