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
