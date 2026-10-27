import test from "node:test";
import assert from "node:assert/strict";
import { createAgentHealthMonitor } from "../src/agent/health-monitor.mjs";

test("health monitor aggregates success, failure, duration, and budget without raw content", () => {
  const monitor = createAgentHealthMonitor({ now: () => 1234 });
  assert.equal(monitor.record({
    agentId: "seo-audit", outcome: "succeeded", durationMs: 100, budgetUnits: 2,
    prompt: "private text", output: "private output", apiKey: "secret",
  }).ok, true);
  monitor.record({ agentId: "seo-audit", outcome: "failed", durationMs: 300, budgetUnits: 1, code: "PROVIDER_TIMEOUT" });
  assert.deepEqual(monitor.get("seo-audit"), {
    agentId: "seo-audit", runs: 2, succeeded: 1, failed: 1, totalDurationMs: 400,
    averageDurationMs: 200, budgetUnits: 3, lastOutcome: "failed", lastCode: "PROVIDER_TIMEOUT", lastAt: 1234,
  });
  assert.equal(JSON.stringify(monitor.list()).includes("private"), false);
  assert.equal(JSON.stringify(monitor.list()).includes("secret"), false);
});

test("health monitor bounds cardinality and validates metric fields", () => {
  const monitor = createAgentHealthMonitor({ maxAgents: 1, now: () => 10 });
  assert.equal(monitor.record({ agentId: "one", outcome: "succeeded", durationMs: 0 }).ok, true);
  assert.deepEqual(monitor.record({ agentId: "two", outcome: "failed", durationMs: 1 }), { ok: false, code: "HEALTH_CAPACITY_REACHED" });
  assert.deepEqual(monitor.record({ agentId: "bad id", outcome: "failed", durationMs: 1 }), { ok: false, code: "INVALID_HEALTH_METRIC" });
  assert.deepEqual(monitor.record({ agentId: "one", outcome: "unknown", durationMs: 1 }), { ok: false, code: "INVALID_HEALTH_METRIC" });
  assert.deepEqual(monitor.record({ agentId: "one", outcome: "failed", durationMs: -1 }), { ok: false, code: "INVALID_HEALTH_METRIC" });
  assert.deepEqual(monitor.record({ agentId: "one", outcome: "failed", durationMs: 1, code: "unsafe code" }), { ok: false, code: "INVALID_HEALTH_METRIC" });
  assert.equal(monitor.size, 1);
});

test("health monitor returns detached snapshots and sorts listing deterministically", () => {
  let clock = 1;
  const monitor = createAgentHealthMonitor({ now: () => clock++ });
  monitor.record({ agentId: "zeta", outcome: "succeeded", durationMs: 10 });
  monitor.record({ agentId: "alpha", outcome: "failed", durationMs: 20, code: "FAILED" });
  const snapshot = monitor.get("zeta");
  snapshot.runs = 999;
  assert.equal(monitor.get("zeta").runs, 1);
  assert.deepEqual(monitor.list().map((item) => item.agentId), ["alpha", "zeta"]);
});

test("health monitor fails closed on clock errors and supports clearing", () => {
  const broken = createAgentHealthMonitor({ now: () => { throw new Error("private clock error"); } });
  assert.deepEqual(broken.record({ agentId: "agent", outcome: "failed", durationMs: 1 }), { ok: false, code: "HEALTH_CLOCK_FAILED" });
  assert.equal(broken.size, 0);

  const monitor = createAgentHealthMonitor({ now: () => 1 });
  monitor.record({ agentId: "agent", outcome: "succeeded", durationMs: 1 });
  monitor.clear();
  assert.equal(monitor.size, 0);
  assert.deepEqual(monitor.list(), []);
});

test("health monitor validates configuration limits", () => {
  assert.throws(() => createAgentHealthMonitor({ maxAgents: 0 }), /INVALID_HEALTH_MONITOR_LIMIT/);
  assert.throws(() => createAgentHealthMonitor({ maxAgents: 257 }), /INVALID_HEALTH_MONITOR_LIMIT/);
  assert.throws(() => createAgentHealthMonitor({ now: 1 }), /INVALID_HEALTH_MONITOR_CLOCK/);
});


test("health monitor safely rejects null, arrays, and primitive records", () => {
  const monitor = createAgentHealthMonitor({ now: () => 10 });
  for (const input of [null, [], "bad", 7, true]) {
    assert.deepEqual(monitor.record(input), { ok: false, code: "INVALID_HEALTH_METRIC" });
  }
  assert.equal(monitor.size, 0);
});
