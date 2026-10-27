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
    assert.equal((await response.json()).reply, "Odgovor iz testnog provajdera");
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
