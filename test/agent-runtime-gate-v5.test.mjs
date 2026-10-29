import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAgentRuntimeGate } from "../src/v5-modules/agent-runtime-gate.mjs";

const enabledEnv = {
  CEOAI_AGENT_RUNTIME_ENABLED: "true",
  CEOAI_AGENT_RUNTIME_FREE_ONLY: "true",
  CEOAI_AGENT_RUNTIME_EXTERNAL_ACTIONS: "false",
  CEOAI_AGENT_RUNTIME_PAID_SERVICES: "false",
};
const dependencies = {
  invokeAgent: async () => ({}),
  reserveQuota: async () => ({ allowed: true }),
  validateResult: () => ({ valid: true }),
  providerEligibility: true,
  atomicQuota: true,
};

test("runtime gate is blocked by default and never claims execution", () => {
  const gate = evaluateAgentRuntimeGate();
  assert.equal(gate.allowed, false);
  assert.equal(gate.mode, "blocked");
  assert.equal(gate.execution_started, false);
  assert.equal(gate.external_actions_allowed, false);
  assert.equal(gate.paid_services_allowed, false);
  assert.ok(gate.blockers.includes("runtime_not_explicitly_enabled"));
  assert.ok(gate.blockers.includes("atomic_quota_not_confirmed"));
});
test("runtime gate opens only when every prerequisite is explicit", () => {
  const gate = evaluateAgentRuntimeGate(enabledEnv, dependencies);
  assert.equal(gate.allowed, true);
  assert.equal(gate.mode, "prerequisites-present");
  assert.equal(gate.execution_started, false);
  assert.deepEqual(gate.blockers, []);
});
test("missing atomic quota reservation blocks runtime", () => {
  const { reserveQuota, ...missing } = dependencies;
  const gate = evaluateAgentRuntimeGate(enabledEnv, missing);
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.includes("atomic_quota_reserver_missing"));
  assert.ok(gate.blockers.includes("atomic_quota_not_confirmed"));
});
test("KV-style best-effort quota is not accepted as atomic quota", () => {
  const gate = evaluateAgentRuntimeGate(enabledEnv, { ...dependencies, atomicQuota: false });
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.includes("atomic_quota_not_confirmed"));
});
test("runtime stays blocked if free-only policy is not confirmed", () => {
  const gate = evaluateAgentRuntimeGate({ ...enabledEnv, CEOAI_AGENT_RUNTIME_FREE_ONLY: "false" }, dependencies);
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.includes("free_only_policy_not_confirmed"));
});
test("runtime stays blocked unless external actions and paid services are explicitly disabled", () => {
  const gate = evaluateAgentRuntimeGate({
    ...enabledEnv,
    CEOAI_AGENT_RUNTIME_EXTERNAL_ACTIONS: "true",
    CEOAI_AGENT_RUNTIME_PAID_SERVICES: "true",
  }, dependencies);
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.includes("external_actions_not_disabled"));
  assert.ok(gate.blockers.includes("paid_services_not_disabled"));
});
test("missing invoker or validator blocks runtime", () => {
  const gate = evaluateAgentRuntimeGate(enabledEnv, {
    ...dependencies, invokeAgent: null, validateResult: null,
  });
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.includes("agent_invoker_missing"));
  assert.ok(gate.blockers.includes("result_validator_missing"));
});
test("provider eligibility must be explicitly confirmed", () => {
  const gate = evaluateAgentRuntimeGate(enabledEnv, { ...dependencies, providerEligibility: false });
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockers.includes("free_provider_eligibility_not_confirmed"));
});
test("gate output is immutable and does not expose provider secrets", () => {
  const gate = evaluateAgentRuntimeGate(enabledEnv, dependencies);
  assert.equal(Object.isFrozen(gate), true);
  assert.equal(JSON.stringify(gate).includes("API_KEY"), false);
  assert.equal(JSON.stringify(gate).includes("token"), false);
});
