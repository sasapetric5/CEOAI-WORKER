import test from "node:test";
import assert from "node:assert/strict";
import { reserveAtomicDailyQuota } from "../src/v5-modules/atomic-quota-reservation.mjs";
import { evaluateAgentRuntimeGate } from "../src/v5-modules/agent-runtime-gate.mjs";

const okResponse = (value, status = 200) => ({ status, async json() { return value; } });
const validDeps = {
  invokeAgent: async () => ({ output: "test" }),
  reserveQuota: async () => ({ allowed: true, count: 1 }),
  validateResult: () => ({ valid: true }),
  providerEligibility: true,
  atomicQuota: true,
};
const validEnv = {
  CEOAI_AGENT_RUNTIME_ENABLED: "true",
  CEOAI_AGENT_RUNTIME_FREE_ONLY: "true",
  CEOAI_AGENT_RUNTIME_EXTERNAL_ACTIONS: "false",
  CEOAI_AGENT_RUNTIME_PAID_SERVICES: "false",
};

// Atomic quota adapter: adversarial backend responses must never grant an invalid reservation.
const malformedResponses = [
  ["missing payload", undefined],
  ["null payload", null],
  ["array payload", []],
  ["string payload", "allowed"],
  ["numeric payload", 1],
  ["missing allowed flag", { count: 1 }],
  ["missing count", { allowed: true }],
  ["string count", { allowed: true, count: "1" }],
  ["negative count", { allowed: true, count: -1 }],
  ["fractional count", { allowed: true, count: 1.25 }],
  ["unsafe integer count", { allowed: true, count: Number.MAX_SAFE_INTEGER + 1 }],
  ["allowed zero count", { allowed: true, count: 0 }],
  ["allowed over limit", { allowed: true, count: 6 }],
];
for (const [label, payload] of malformedResponses) {
  test("quota adapter fails closed for " + label, async () => {
    const coordinator = { async fetch() { return okResponse(payload); } };
    const result = await reserveAtomicDailyQuota(coordinator, "provider-a", 5, Date.UTC(2026, 9, 29));
    assert.equal(result.allowed, false);
  });
}

const invalidStatuses = [0, 201, 202, 204, 301, 400, 401, 403, 404, 409, 429, 500, 502, 503, 504];
for (const status of invalidStatuses) {
  test("quota adapter denies HTTP status " + status, async () => {
    const coordinator = { async fetch() { return okResponse({ allowed: true, count: 1 }, status); } };
    const result = await reserveAtomicDailyQuota(coordinator, "provider-a", 5, Date.UTC(2026, 9, 29));
    assert.equal(result.allowed, false);
  });
}

const invalidIds = [
  "../provider", "provider/path", "provider?x=1", "provider#fragment", "provider name",
  " provider", "provider ", "provider\n", "provider\t", "provider\\name",
  ".", "..", "-", "_", "a".repeat(81),
];
for (const providerId of invalidIds) {
  test("quota adapter rejects unsafe provider identifier " + JSON.stringify(providerId), async () => {
    let called = false;
    const coordinator = { async fetch() { called = true; return okResponse({ allowed: true, count: 1 }); } };
    const result = await reserveAtomicDailyQuota(coordinator, providerId, 5, Date.UTC(2026, 9, 29));
    assert.equal(result.allowed, false);
    assert.equal(called, false);
  });
}

const invalidLimits = [-1, 0, 1.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 1_000_001, "5", null, undefined];
for (const limit of invalidLimits) {
  test("quota adapter rejects invalid limit " + String(limit), async () => {
    let called = false;
    const coordinator = { async fetch() { called = true; return okResponse({ allowed: true, count: 1 }); } };
    const result = await reserveAtomicDailyQuota(coordinator, "provider-a", limit, Date.UTC(2026, 9, 29));
    assert.equal(result.allowed, false);
    assert.equal(called, false);
  });
}

// Runtime gate: each individual policy switch must be fail-closed.
const policyMutations = [
  ["runtime flag unset", { CEOAI_AGENT_RUNTIME_ENABLED: undefined }, "runtime_not_explicitly_enabled"],
  ["runtime flag false", { CEOAI_AGENT_RUNTIME_ENABLED: "false" }, "runtime_not_explicitly_enabled"],
  ["runtime flag uppercase", { CEOAI_AGENT_RUNTIME_ENABLED: "TRUE" }, "runtime_not_explicitly_enabled"],
  ["free-only unset", { CEOAI_AGENT_RUNTIME_FREE_ONLY: undefined }, "free_only_policy_not_confirmed"],
  ["free-only false", { CEOAI_AGENT_RUNTIME_FREE_ONLY: "false" }, "free_only_policy_not_confirmed"],
  ["free-only yes", { CEOAI_AGENT_RUNTIME_FREE_ONLY: "yes" }, "free_only_policy_not_confirmed"],
  ["external actions unset", { CEOAI_AGENT_RUNTIME_EXTERNAL_ACTIONS: undefined }, "external_actions_not_disabled"],
  ["external actions true", { CEOAI_AGENT_RUNTIME_EXTERNAL_ACTIONS: "true" }, "external_actions_not_disabled"],
  ["external actions zero", { CEOAI_AGENT_RUNTIME_EXTERNAL_ACTIONS: "0" }, "external_actions_not_disabled"],
  ["paid services unset", { CEOAI_AGENT_RUNTIME_PAID_SERVICES: undefined }, "paid_services_not_disabled"],
  ["paid services true", { CEOAI_AGENT_RUNTIME_PAID_SERVICES: "true" }, "paid_services_not_disabled"],
  ["paid services no", { CEOAI_AGENT_RUNTIME_PAID_SERVICES: "no" }, "paid_services_not_disabled"],
];
for (const [label, mutation, blocker] of policyMutations) {
  test("runtime gate blocks when " + label, () => {
    const env = { ...validEnv };
    for (const [key, value] of Object.entries(mutation)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
    const gate = evaluateAgentRuntimeGate(env, validDeps);
    assert.equal(gate.allowed, false);
    assert.ok(gate.blockers.includes(blocker));
    assert.equal(gate.execution_started, false);
    assert.equal(gate.can_execute_agents, false);
  });
}

const dependencyMutations = [
  ["invoker null", { invokeAgent: null }, "agent_invoker_missing"],
  ["invoker object", { invokeAgent: {} }, "agent_invoker_missing"],
  ["invoker string", { invokeAgent: "call" }, "agent_invoker_missing"],
  ["quota reserver null", { reserveQuota: null }, "atomic_quota_reserver_missing"],
  ["quota reserver object", { reserveQuota: {} }, "atomic_quota_reserver_missing"],
  ["validator null", { validateResult: null }, "result_validator_missing"],
  ["validator object", { validateResult: {} }, "result_validator_missing"],
  ["provider eligibility omitted", { providerEligibility: undefined }, "free_provider_eligibility_not_confirmed"],
  ["provider eligibility truthy string", { providerEligibility: "true" }, "free_provider_eligibility_not_confirmed"],
  ["atomic quota omitted", { atomicQuota: undefined }, "atomic_quota_not_confirmed"],
  ["atomic quota truthy string", { atomicQuota: "true" }, "atomic_quota_not_confirmed"],
];
for (const [label, mutation, blocker] of dependencyMutations) {
  test("runtime gate blocks when " + label, () => {
    const deps = { ...validDeps, ...mutation };
    const gate = evaluateAgentRuntimeGate(validEnv, deps);
    assert.equal(gate.allowed, false);
    assert.ok(gate.blockers.includes(blocker));
    assert.equal(gate.execution_started, false);
    assert.equal(gate.external_actions_allowed, false);
    assert.equal(gate.paid_services_allowed, false);
  });
}

test("runtime gate remains readiness-only even when all prerequisite checks pass", () => {
  const gate = evaluateAgentRuntimeGate(validEnv, validDeps);
  assert.equal(gate.allowed, true);
  assert.equal(gate.mode, "prerequisites-present");
  assert.equal(gate.readiness_only, true);
  assert.equal(gate.can_execute_agents, false);
  assert.equal(gate.execution_started, false);
});

test("runtime gate does not expose dependency function source or secrets", () => {
  const secret = "PRIVATE_TEST_SECRET_DO_NOT_LEAK";
  const gate = evaluateAgentRuntimeGate(validEnv, {
    ...validDeps,
    invokeAgent: async () => secret,
  });
  const serialized = JSON.stringify(gate);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("invokeAgent"), false);
});

test("runtime gate returns a frozen top-level result", () => {
  const gate = evaluateAgentRuntimeGate(validEnv, validDeps);
  assert.equal(Object.isFrozen(gate), true);
});
