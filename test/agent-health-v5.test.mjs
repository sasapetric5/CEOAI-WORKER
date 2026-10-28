import test from "node:test";
import assert from "node:assert/strict";
import { readProviderHealth, recordProviderOutcome, recordProviderLatency, PROVIDER_HEALTH_TTL_SECONDS } from "../src/v5-modules/agent-health.mjs";

class MemoryKV {
  constructor() { this.data = new Map(); this.options = new Map(); }
  async get(key, type) {
    const value = this.data.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value, options) {
    this.data.set(key, String(value));
    this.options.set(key, options);
  }
}

test("health monitor records success and clears consecutive failures", async () => {
  const kv = new MemoryKV();
  assert.equal(await recordProviderOutcome(kv, "gemini-1", { kind: "failure", statusCode: 503 }, 1000), true);
  assert.equal(await recordProviderOutcome(kv, "gemini-1", { kind: "failure", statusCode: 503 }, 2000), true);
  assert.equal(await recordProviderOutcome(kv, "gemini-1", { kind: "success" }, 3000), true);
  const health = await readProviderHealth(kv, "gemini-1");
  assert.equal(health.status, "healthy");
  assert.equal(health.attempts, 3);
  assert.equal(health.successes, 1);
  assert.equal(health.failures, 2);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastSuccessAt, 3000);
  assert.equal(health.lastFailureAt, 2000);
});

test("health monitor classifies rate limits and provider outages", async () => {
  const kv = new MemoryKV();
  await recordProviderOutcome(kv, "openrouter-1", { kind: "failure", statusCode: 429 }, 4000);
  assert.equal((await readProviderHealth(kv, "openrouter-1")).status, "rate_limited");
  await recordProviderOutcome(kv, "openrouter-1", { kind: "failure", statusCode: 503 }, 5000);
  const health = await readProviderHealth(kv, "openrouter-1");
  assert.equal(health.status, "unavailable");
  assert.equal(health.consecutiveFailures, 2);
});

test("health records expire and contain no prompts, replies, or API keys", async () => {
  const kv = new MemoryKV();
  await recordProviderOutcome(kv, "workers-ai-1", { kind: "success" }, 6000);
  const key = "health:provider:workers-ai-1";
  assert.deepEqual(kv.options.get(key), { expirationTtl: PROVIDER_HEALTH_TTL_SECONDS });
  const stored = kv.data.get(key);
  assert.doesNotMatch(stored, /prompt|reply|api.?key|secret/i);
});

test("malformed persisted health counters are normalized", async () => {
  const kv = new MemoryKV();
  kv.data.set("health:provider:gemini-1", JSON.stringify({
    provider: "gemini-1", status: "healthy", attempts: -2, successes: "many",
    failures: Number.MAX_SAFE_INTEGER + 1, consecutiveFailures: 4,
  }));
  const health = await readProviderHealth(kv, "gemini-1");
  assert.equal(health.attempts, 0);
  assert.equal(health.successes, 0);
  assert.equal(health.failures, 0);
  assert.equal(health.consecutiveFailures, 4);
});

test("monitoring storage failure never throws into chat execution", async () => {
  const brokenKV = {
    async get() { throw new Error("KV read failed"); },
    async put() { throw new Error("KV write failed"); },
  };
  assert.equal(await recordProviderOutcome(brokenKV, "deepseek-1", { kind: "failure", statusCode: 503 }, 7000), false);
});

test("invalid provider IDs and outcomes are rejected safely", async () => {
  const kv = new MemoryKV();
  await assert.rejects(() => readProviderHealth(kv, "../memory:session"), /Invalid provider ID/);
  assert.equal(await recordProviderOutcome(kv, "gemini-1", { kind: "unknown" }, 8000), false);
  assert.equal(await recordProviderOutcome(kv, "gemini-1", { kind: "success" }, -1), false);
});


test("latency samples update bounded EWMA without changing outcome counters", async () => {
  const kv = new MemoryKV();
  assert.equal(await recordProviderLatency(kv, "gemini-1", 1000, 1000), true);
  assert.equal(await recordProviderLatency(kv, "gemini-1", 2000, 2000), true);
  const health = await readProviderHealth(kv, "gemini-1");
  assert.equal(health.latencyEwmaMs, 1300);
  assert.equal(health.latencySamples, 2);
  assert.equal(health.attempts, 0);
  assert.equal(health.successes, 0);
  assert.equal(health.failures, 0);
});

test("invalid latency samples and KV outages are ignored safely", async () => {
  const kv = new MemoryKV();
  assert.equal(await recordProviderLatency(kv, "gemini-1", 0, 1000), false);
  assert.equal(await recordProviderLatency(kv, "gemini-1", 120001, 1000), false);
  assert.equal(await recordProviderLatency(kv, "gemini-1", 200, -1), false);
  const broken = { async get() { throw new Error("private storage detail"); }, async put() { throw new Error("private storage detail"); } };
  assert.equal(await recordProviderLatency(broken, "gemini-1", 200, 1000), false);
});

test("malformed persisted health metadata cannot spoof routing status or inject unbounded fields", async () => {
  const kv = new MemoryKV();
  kv.data.set("health:provider:gemini-1", JSON.stringify({
    provider: "gemini-1", status: "healthy", updatedAt: "not-a-time",
    lastOutcomeAt: "yesterday", lastSuccessAt: -1, lastFailureAt: 9e99,
    lastStatusCode: 999, lastFailureClass: "x".repeat(5000),
    latencyEwmaMs: -50, latencySamples: -3, unexpected: "must-not-survive",
    attempts: 2, successes: 1, failures: 1, consecutiveFailures: 1,
  }));
  const health = await readProviderHealth(kv, "gemini-1");
  assert.equal(health.status, "unknown");
  assert.equal(health.updatedAt > 0, true);
  assert.equal(health.lastOutcomeAt, null);
  assert.equal(health.lastSuccessAt, null);
  assert.equal(health.lastFailureAt, null);
  assert.equal(health.lastStatusCode, null);
  assert.equal(health.lastFailureClass, null);
  assert.equal(health.latencyEwmaMs, undefined);
  assert.equal(health.latencySamples, undefined);
  assert.equal(health.unexpected, undefined);
});

