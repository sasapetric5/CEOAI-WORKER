import test from "node:test";
import assert from "node:assert/strict";
import {
  providerCircuitDecision,
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  PROVIDER_CIRCUIT_OPEN_MS,
} from "../src/v5-modules/provider-circuit-breaker.mjs";
import {
  createRequestDeadline,
  remainingRequestBudget,
  adaptiveProviderTimeout,
  canStartProviderAttempt,
  DEFAULT_REQUEST_BUDGET_MS,
  MIN_ATTEMPT_BUDGET_MS,
  MIN_PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_TIMEOUT_MS,
} from "../src/v5-modules/adaptive-timeout.mjs";
import {
  providerHealthRoutingAdjustment,
  providerRecoveryAction,
} from "../src/v5-modules/provider-recovery.mjs";

const NOW = 5_000_000;
const transientHealth = (overrides = {}) => ({
  consecutiveFailures: PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  lastStatusCode: 503,
  lastFailureClass: "server_error",
  lastFailureAt: NOW - 1000,
  ...overrides,
});

// Circuit-breaker status classification: do not conflate policy errors with transient outages.
for (const status of [400, 401, 403, 404, 405, 408, 409, 422, 429]) {
  test("circuit remains closed for non-transient HTTP " + status, () => {
    const result = providerCircuitDecision(transientHealth({ lastStatusCode: status, lastFailureClass: null }), NOW);
    assert.equal(result.state, "closed");
    assert.equal(result.retryInMs, 0);
  });
}
for (const status of [500, 501, 502, 503, 504, 505, 550, 599]) {
  test("circuit opens after threshold for transient HTTP " + status, () => {
    const result = providerCircuitDecision(transientHealth({ lastStatusCode: status, lastFailureClass: null }), NOW);
    assert.equal(result.state, "open");
    assert.equal(result.retryInMs, PROVIDER_CIRCUIT_OPEN_MS - 1000);
  });
}

const invalidHealthCases = [
  ["null health", null],
  ["undefined health", undefined],
  ["string health", "bad"],
  ["numeric health", 12],
  ["array health", []],
  ["negative failure count", transientHealth({ consecutiveFailures: -1 })],
  ["fractional failure count", transientHealth({ consecutiveFailures: 3.5 })],
  ["NaN failure count", transientHealth({ consecutiveFailures: NaN })],
  ["infinite failure count", transientHealth({ consecutiveFailures: Infinity })],
  ["missing failure timestamp", transientHealth({ lastFailureAt: undefined })],
  ["future failure timestamp", transientHealth({ lastFailureAt: NOW + 1 })],
  ["negative failure timestamp", transientHealth({ lastFailureAt: -1 })],
  ["unknown failure class", transientHealth({ lastFailureClass: "unknown_private_error" })],
];
for (const [label, health] of invalidHealthCases) {
  test("circuit fails safely for " + label, () => {
    const result = providerCircuitDecision(health, NOW);
    assert.equal(result.state, "closed");
    assert.equal(Number.isFinite(result.retryInMs), true);
    assert.equal(result.retryInMs >= 0, true);
  });
}

for (const elapsed of [0, 1, 10, 100, 1000, 10_000, 60_000, 120_000, 299_999]) {
  test("circuit remains open at elapsed " + elapsed + "ms before cooldown expires", () => {
    const health = transientHealth({ lastFailureAt: NOW - elapsed });
    const result = providerCircuitDecision(health, NOW);
    assert.equal(result.state, "open");
    assert.equal(result.retryInMs, PROVIDER_CIRCUIT_OPEN_MS - elapsed);
  });
}
test("circuit transitions exactly at cooldown boundary", () => {
  const health = transientHealth({ lastFailureAt: NOW - PROVIDER_CIRCUIT_OPEN_MS });
  assert.deepEqual(providerCircuitDecision(health, NOW), {
    state: "half_open",
    consecutiveFailures: PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
    retryInMs: 0,
  });
});
test("circuit never returns negative retry time after cooldown", () => {
  const health = transientHealth({ lastFailureAt: NOW - PROVIDER_CIRCUIT_OPEN_MS - 60_000 });
  const result = providerCircuitDecision(health, NOW);
  assert.equal(result.state, "half_open");
  assert.equal(result.retryInMs, 0);
});

// Request-deadline bounds: every attempt must fit inside the request's remaining budget.
const invalidDeadlineInputs = [
  [NaN, 1000], [Infinity, 1000], [-1, 1000], [1000, NaN], [1000, Infinity],
  [1000, -1], [1000, 0], [1000, MIN_ATTEMPT_BUDGET_MS - 1],
  [1000, DEFAULT_REQUEST_BUDGET_MS + 1],
];
for (const [now, budget] of invalidDeadlineInputs) {
  test("deadline rejects invalid inputs now=" + now + " budget=" + budget, () => {
    assert.equal(createRequestDeadline(now, budget), null);
  });
}
for (const budget of [MIN_ATTEMPT_BUDGET_MS, 3000, 5000, 10_000, DEFAULT_REQUEST_BUDGET_MS]) {
  test("deadline accepts bounded budget " + budget, () => {
    assert.equal(createRequestDeadline(NOW, budget), NOW + budget);
  });
}
for (const remaining of [0, 1, 100, MIN_ATTEMPT_BUDGET_MS - 1, NaN, Infinity, -Infinity]) {
  test("adaptive timeout refuses insufficient or invalid budget " + remaining, () => {
    assert.equal(adaptiveProviderTimeout(remaining), 0);
    assert.equal(canStartProviderAttempt(remaining), false);
  });
}
for (const remaining of [MIN_ATTEMPT_BUDGET_MS, 3000, 4000, 8000, 15_000, 24_000]) {
  test("adaptive timeout never exceeds remaining budget " + remaining, () => {
    const timeout = adaptiveProviderTimeout(remaining);
    assert.ok(timeout <= remaining);
    assert.ok(timeout >= MIN_ATTEMPT_BUDGET_MS);
    assert.equal(canStartProviderAttempt(remaining), true);
  });
}
for (const latency of [-1, 0, NaN, Infinity, 120_001, "fast", null]) {
  test("adaptive timeout ignores invalid latency estimate " + String(latency), () => {
    assert.equal(adaptiveProviderTimeout(10_000, latency), 8000);
  });
}
test("adaptive timeout clamps very low latency to minimum provider timeout", () => {
  assert.equal(adaptiveProviderTimeout(20_000, 1), MIN_PROVIDER_TIMEOUT_MS);
});
test("adaptive timeout clamps very high valid latency to maximum provider timeout", () => {
  assert.equal(adaptiveProviderTimeout(20_000, 120_000), MAX_PROVIDER_TIMEOUT_MS);
});
test("remaining request budget never becomes negative", () => {
  assert.equal(remainingRequestBudget(NOW, NOW + 1), 0);
  assert.equal(remainingRequestBudget(NOW, NOW + 10_000), 0);
});
test("remaining request budget floors fractional milliseconds", () => {
  assert.equal(remainingRequestBudget(NOW + 12.9, NOW), 12);
});
test("attempt can start at exact minimum budget boundary", () => {
  assert.equal(canStartProviderAttempt(MIN_ATTEMPT_BUDGET_MS), true);
});
test("attempt cannot start one millisecond below minimum budget", () => {
  assert.equal(canStartProviderAttempt(MIN_ATTEMPT_BUDGET_MS - 1), false);
});

// Stale or malformed health should not permanently distort provider selection.
const healthCases = [
  ["healthy current", { status: "healthy", consecutiveFailures: 0, updatedAt: NOW }, 0.2, "recovered"],
  ["unavailable current", { status: "unavailable", consecutiveFailures: 2, updatedAt: NOW }, -0.2, "probe_after_cooldown"],
  ["rate limited current", { status: "rate_limited", consecutiveFailures: 2, updatedAt: NOW }, -0.3, "probe_after_cooldown"],
  ["degraded current", { status: "degraded", consecutiveFailures: 2, updatedAt: NOW }, -0.1, "normal"],
  ["stale unavailable", { status: "unavailable", consecutiveFailures: 3, updatedAt: NOW - 3_600_001 }, 0, "normal"],
  ["future unavailable", { status: "unavailable", consecutiveFailures: 3, updatedAt: NOW + 1 }, 0, "normal"],
  ["missing timestamp", { status: "unavailable", consecutiveFailures: 3 }, 0, "normal"],
];
for (const [label, health, adjustment, action] of healthCases) {
  test("provider recovery policy: " + label, () => {
    assert.equal(providerHealthRoutingAdjustment(health, NOW), adjustment);
    assert.equal(providerRecoveryAction(health, NOW), action);
  });
}
