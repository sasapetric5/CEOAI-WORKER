import test from "node:test";
import assert from "node:assert/strict";
import {
  readRecoveryMetrics,
  recordRecoveryMetric,
  RECOVERY_METRICS_KEY,
  RECOVERY_METRICS_TTL_SECONDS,
} from "../src/v5-modules/recovery-metrics.mjs";

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

test("recovery metrics count only known aggregate events and persist with TTL", async () => {
  const kv = new MemoryKV();
  assert.equal(await recordRecoveryMetric(kv, "provider_failure", 100), true);
  assert.equal(await recordRecoveryMetric(kv, "circuit_open_skip", 110), true);
  assert.equal(await recordRecoveryMetric(kv, "half_open_probe", 120), true);
  assert.equal(await recordRecoveryMetric(kv, "failover_success", 130), true);
  assert.equal(await recordRecoveryMetric(kv, "recovered_request", 140), true);
  assert.equal(await recordRecoveryMetric(kv, "raw-error-text", 150), false);
  const metrics = await readRecoveryMetrics(kv);
  assert.deepEqual({
    providerFailures: metrics.providerFailures,
    circuitOpenSkips: metrics.circuitOpenSkips,
    halfOpenProbes: metrics.halfOpenProbes,
    failoverSuccesses: metrics.failoverSuccesses,
    recoveredRequests: metrics.recoveredRequests,
    lastEventAt: metrics.lastEventAt,
  }, {
    providerFailures: 1, circuitOpenSkips: 1, halfOpenProbes: 1,
    failoverSuccesses: 1, recoveredRequests: 1, lastEventAt: 140,
  });
  assert.equal(kv.options.get(RECOVERY_METRICS_KEY).expirationTtl, RECOVERY_METRICS_TTL_SECONDS);
});

test("metrics tolerate missing or failing KV without throwing", async () => {
  assert.equal(await recordRecoveryMetric(null, "failover_success"), false);
  assert.equal(await readRecoveryMetrics(null), null);
  const broken = {
    async get() { throw new Error("private provider detail"); },
    async put() { throw new Error("private provider detail"); },
  };
  assert.equal(await recordRecoveryMetric(broken, "provider_failure"), false);
  assert.equal(await readRecoveryMetrics(broken), null);
});

test("invalid counters are sanitized and never expose raw provider errors", async () => {
  const kv = new MemoryKV();
  kv.data.set(RECOVERY_METRICS_KEY, JSON.stringify({
    version: 1, providerFailures: -9, circuitOpenSkips: "bad",
    halfOpenProbes: 3, failoverSuccesses: 4, recoveredRequests: 5,
    rawError: "must-not-propagate", lastEventAt: 200,
  }));
  const metrics = await readRecoveryMetrics(kv);
  assert.equal(metrics.providerFailures, 0);
  assert.equal(metrics.circuitOpenSkips, 0);
  assert.equal(metrics.halfOpenProbes, 3);
  assert.equal("rawError" in metrics, false);
});

test("recovery metrics do not replace counters with zero when KV read fails", async () => {
  let writeCalled = false;
  const brokenRead = {
    async get() { throw new Error("read unavailable"); },
    async put() { writeCalled = true; },
  };
  assert.equal(await recordRecoveryMetric(brokenRead, "failover_success", 300), false);
  assert.equal(writeCalled, false);
});

test("malformed recovery timestamps are bounded and unknown fields are discarded", async () => {
  const kv = new MemoryKV();
  kv.data.set(RECOVERY_METRICS_KEY, JSON.stringify({
    version: 1,
    providerFailures: 7,
    circuitOpenSkips: 2,
    halfOpenProbes: 1,
    failoverSuccesses: 3,
    recoveredRequests: 4,
    lastEventAt: 9e99,
    rawError: "must-not-propagate",
    userPrompt: "must-not-propagate",
  }));
  const metrics = await readRecoveryMetrics(kv);
  assert.equal(metrics.providerFailures, 7);
  assert.equal(metrics.lastEventAt <= Date.now() + 60_000, true);
  assert.equal(metrics.lastEventAt >= 0, true);
  assert.equal("rawError" in metrics, false);
  assert.equal("userPrompt" in metrics, false);
});

test("invalid recovery timestamp types do not escape into metrics", async () => {
  const kv = new MemoryKV();
  kv.data.set(RECOVERY_METRICS_KEY, JSON.stringify({
    version: 1, providerFailures: 1, lastEventAt: "yesterday",
  }));
  const metrics = await readRecoveryMetrics(kv);
  assert.equal(metrics.providerFailures, 1);
  assert.equal(Number.isSafeInteger(metrics.lastEventAt), true);
  assert.equal(metrics.lastEventAt >= 0, true);
});

test("recording rejects fractional, non-finite, and excessively future timestamps", async () => {
  const kv = new MemoryKV();
  assert.equal(await recordRecoveryMetric(kv, "failover_success", 12.5), false);
  assert.equal(await recordRecoveryMetric(kv, "failover_success", Number.POSITIVE_INFINITY), false);
  assert.equal(await recordRecoveryMetric(kv, "failover_success", Date.now() + 61_000), false);
  assert.equal(kv.data.has(RECOVERY_METRICS_KEY), false);
});
