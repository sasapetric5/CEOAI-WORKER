import test from "node:test";
import assert from "node:assert/strict";
import {
  providerCircuitDecision,
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  PROVIDER_CIRCUIT_OPEN_MS,
} from "../src/v5-modules/provider-circuit-breaker.mjs";

test("circuit stays closed before threshold and opens after repeated transient failures", () => {
  const now = 1_000_000;
  assert.equal(PROVIDER_CIRCUIT_FAILURE_THRESHOLD, 3);
  assert.equal(providerCircuitDecision({ consecutiveFailures: 2, lastStatusCode: 503, lastFailureAt: now }, now).state, "closed");
  const opened = providerCircuitDecision({ consecutiveFailures: 3, lastStatusCode: 503, lastFailureAt: now }, now + 100);
  assert.equal(opened.state, "open");
  assert.equal(opened.retryInMs, PROVIDER_CIRCUIT_OPEN_MS - 100);
});

test("circuit allows a half-open probe after open interval", () => {
  const now = 2_000_000;
  const result = providerCircuitDecision({
    consecutiveFailures: 3, lastStatusCode: 502, lastFailureAt: now - PROVIDER_CIRCUIT_OPEN_MS,
  }, now);
  assert.equal(result.state, "half_open");
  assert.equal(result.retryInMs, 0);
});

test("success closes circuit through reset failure streak", () => {
  const now = 3_000_000;
  assert.equal(providerCircuitDecision({
    status: "healthy", consecutiveFailures: 0, lastStatusCode: 200, lastFailureAt: now - 10,
  }, now).state, "closed");
});

test("quota, auth, and model errors stay with existing cooldown policy", () => {
  const now = 4_000_000;
  for (const status of [401, 403, 404, 429]) {
    assert.equal(providerCircuitDecision({
      consecutiveFailures: 8, lastStatusCode: status, lastFailureAt: now - 1,
    }, now).state, "closed");
  }
});

test("invalid, stale-future, or missing health never opens the circuit", () => {
  const now = 5_000_000;
  assert.equal(providerCircuitDecision(null, now).state, "closed");
  assert.equal(providerCircuitDecision({ consecutiveFailures: 5, lastStatusCode: 503, lastFailureAt: now + 1 }, now).state, "closed");
  assert.equal(providerCircuitDecision({ consecutiveFailures: 5, lastStatusCode: 503, lastFailureAt: "bad" }, now).state, "closed");
});
