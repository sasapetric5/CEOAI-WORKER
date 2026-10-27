import test from "node:test";
import assert from "node:assert/strict";
import { createAgentAuditLog } from "../src/agent/audit-log.mjs";

test("audit log stores only allowlisted fields and excludes prompt or secret data", () => {
  const audit = createAgentAuditLog({ now: () => 1234 });
  const result = audit.record({
    type: "run_failed", runId: "run_1", code: "TOOL_TIMEOUT", step: 2, toolCalls: 1,
    prompt: "private user text", apiKey: "secret-value", metadata: { token: "secret-value" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(audit.list(), [{ timestamp: 1234, type: "run_failed", runId: "run_1", code: "TOOL_TIMEOUT", step: 2, toolCalls: 1 }]);
  assert.equal(JSON.stringify(audit.list()).includes("secret-value"), false);
  assert.equal(JSON.stringify(audit.list()).includes("private user text"), false);
});

test("audit log is bounded and filters by run", () => {
  const audit = createAgentAuditLog({ maxEvents: 2, now: () => 7 });
  audit.record({ type: "run_started", runId: "a" });
  audit.record({ type: "tool_succeeded", runId: "b", toolCalls: 1 });
  audit.record({ type: "run_succeeded", runId: "a", durationMs: 9 });
  assert.equal(audit.size, 2);
  assert.deepEqual(audit.list().map(e => e.type), ["tool_succeeded", "run_succeeded"]);
  assert.equal(audit.list({ runId: "a" }).length, 1);
});

test("audit log rejects malformed event data and unsafe limits", () => {
  assert.throws(() => createAgentAuditLog({ maxEvents: 1001 }), /INVALID_AUDIT_LIMIT/);
  const audit = createAgentAuditLog();
  assert.equal(audit.record({ type: "unknown", runId: "a" }).code, "INVALID_AUDIT_EVENT");
  assert.equal(audit.record({ type: "run_started", runId: "bad id" }).code, "INVALID_AUDIT_EVENT");
  assert.equal(audit.record({ type: "run_started", runId: "a", durationMs: -1 }).code, "INVALID_AUDIT_EVENT");
  assert.deepEqual(audit.list({ limit: 1001 }), []);
});

test("audit log handles clock failure without recording partial events", () => {
  const audit = createAgentAuditLog({ now: () => { throw new Error("private"); } });
  assert.equal(audit.record({ type: "run_started", runId: "a" }).code, "AUDIT_CLOCK_FAILED");
  assert.equal(audit.size, 0);
});

test("audit log snapshots cannot mutate stored events and eviction remains bounded", () => {
  const audit = createAgentAuditLog({ maxEvents: 2, now: () => 99 });
  audit.record({ type: "run_started", runId: "first" });
  const snapshot = audit.list();
  snapshot[0].runId = "tampered";
  snapshot.push({ type: "run_failed", runId: "injected" });
  assert.equal(audit.size, 1);
  assert.equal(audit.list()[0].runId, "first");
  audit.record({ type: "run_started", runId: "second" });
  audit.record({ type: "run_succeeded", runId: "third" });
  assert.equal(audit.size, 2);
  assert.deepEqual(audit.list().map(event => event.runId), ["second", "third"]);
});

test("audit log clear removes all retained events", () => {
  const audit = createAgentAuditLog({ now: () => 100 });
  audit.record({ type: "run_started", runId: "clear_me" });
  audit.clear();
  assert.equal(audit.size, 0);
  assert.deepEqual(audit.list(), []);
});
