import test from "node:test";
import assert from "node:assert/strict";
import { recordProviderOutcome, readProviderHealth } from "../src/v5-modules/agent-health.mjs";
import {
  providerCircuitDecision,
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  PROVIDER_CIRCUIT_OPEN_MS,
} from "../src/v5-modules/provider-circuit-breaker.mjs";
import { classifyProviderFailure } from "../src/v5-modules/failure-classification.mjs";

class MemoryKV {
  constructor() { this.data = new Map(); }
  async get(key, type) {
    const value = this.data.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.data.set(key, String(value)); }
}

test("three consecutive transient failures open the circuit and suppress retries for five minutes", async () => {
  const kv = new MemoryKV();
  const start = 1_000_000;
  for (let i = 1; i <= PROVIDER_CIRCUIT_FAILURE_THRESHOLD; i++) {
    const failure = classifyProviderFailure({ status: 503, message: "temporary upstream outage" });
    assert.equal(failure.classification, "server_error");
    assert.equal(await recordProviderOutcome(kv, "provider-a", {
      kind: "failure", statusCode: 503, failureClass: failure.classification,
    }, start + i * 100), true);
  }
  const health = await readProviderHealth(kv, "provider-a");
  assert.equal(health.consecutiveFailures, 3);
  assert.equal(providerCircuitDecision(health, start + 301).state, "open");
  assert.equal(providerCircuitDecision(health, health.lastFailureAt + PROVIDER_CIRCUIT_OPEN_MS - 1).state, "open");
  const probe = providerCircuitDecision(health, health.lastFailureAt + PROVIDER_CIRCUIT_OPEN_MS);
  assert.equal(probe.state, "half_open");
  assert.equal(probe.retryInMs, 0);
});

test("successful half-open probe resets failure streak and closes circuit", async () => {
  const kv = new MemoryKV();
  const now = 2_000_000;
  for (let i = 1; i <= 3; i++) {
    await recordProviderOutcome(kv, "provider-b", {
      kind: "failure", statusCode: 503, failureClass: "server_error",
    }, now + i);
  }
  let health = await readProviderHealth(kv, "provider-b");
  const probeAt = health.lastFailureAt + PROVIDER_CIRCUIT_OPEN_MS;
  assert.equal(providerCircuitDecision(health, probeAt).state, "half_open");
  assert.equal(await recordProviderOutcome(kv, "provider-b", { kind: "success" }, probeAt + 1), true);
  health = await readProviderHealth(kv, "provider-b");
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.status, "healthy");
  assert.equal(providerCircuitDecision(health, probeAt + 1).state, "closed");
});

test("401, 404, and 429 remain outside transient circuit policy", async () => {
  const cases = [
    [401, "auth_or_policy"],
    [404, "model_unavailable"],
    [429, "rate_limited"],
  ];
  for (const [status, failureClass] of cases) {
    const kv = new MemoryKV();
    const now = 3_000_000;
    for (let i = 1; i <= 4; i++) {
      await recordProviderOutcome(kv, "provider-c", {
        kind: "failure", statusCode: status, failureClass,
      }, now + i);
    }
    const health = await readProviderHealth(kv, "provider-c");
    assert.equal(health.consecutiveFailures, 4);
    assert.equal(providerCircuitDecision(health, now + 100).state, "closed", `status ${status}`);
  }
});

test("KV health failures do not throw or block provider recovery validation", async () => {
  const broken = { async get() { throw new Error("private details"); }, async put() { throw new Error("private details"); } };
  assert.equal(await recordProviderOutcome(broken, "provider-d", {
    kind: "failure", statusCode: 503, failureClass: "server_error",
  }, 4_000_000), false);
});
