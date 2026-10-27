import test from "node:test";
import assert from "node:assert/strict";
import {
  createRequestDeadline, remainingRequestBudget, adaptiveProviderTimeout, canStartProviderAttempt,
  DEFAULT_REQUEST_BUDGET_MS, MIN_ATTEMPT_BUDGET_MS, MIN_PROVIDER_TIMEOUT_MS, MAX_PROVIDER_TIMEOUT_MS,
} from "../src/v5-modules/adaptive-timeout.mjs";

test("request deadline is bounded and computes remaining budget monotonically", () => {
  const deadline = createRequestDeadline(1000);
  assert.equal(deadline, 1000 + DEFAULT_REQUEST_BUDGET_MS);
  assert.equal(remainingRequestBudget(deadline, 2000), DEFAULT_REQUEST_BUDGET_MS - 1000);
  assert.equal(remainingRequestBudget(deadline, deadline), 0);
  assert.equal(remainingRequestBudget(deadline, deadline + 500), 0);
  assert.equal(createRequestDeadline(-1), null);
  assert.equal(createRequestDeadline(100, DEFAULT_REQUEST_BUDGET_MS + 1), null);
});

test("adaptive timeout follows provider latency but remains within hard bounds", () => {
  assert.equal(adaptiveProviderTimeout(20000, null), 8000);
  assert.equal(adaptiveProviderTimeout(20000, 1000), MIN_PROVIDER_TIMEOUT_MS);
  assert.equal(adaptiveProviderTimeout(20000, 5000), MAX_PROVIDER_TIMEOUT_MS);
  assert.equal(adaptiveProviderTimeout(20000, 120000), MAX_PROVIDER_TIMEOUT_MS);
  assert.equal(adaptiveProviderTimeout(5000, 1000), MIN_PROVIDER_TIMEOUT_MS);
});

test("no new provider attempt starts when the remaining deadline is too short", () => {
  assert.equal(canStartProviderAttempt(MIN_ATTEMPT_BUDGET_MS), true);
  assert.equal(canStartProviderAttempt(MIN_ATTEMPT_BUDGET_MS - 1), false);
  assert.equal(adaptiveProviderTimeout(1999, 500), 0);
  assert.equal(adaptiveProviderTimeout(0, 500), 0);
});

test("invalid latency telemetry uses the safe default timeout", () => {
  assert.equal(adaptiveProviderTimeout(20000, -1), 8000);
  assert.equal(adaptiveProviderTimeout(20000, Number.NaN), 8000);
  assert.equal(adaptiveProviderTimeout(20000, 120001), 8000);
});
