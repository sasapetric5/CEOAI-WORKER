import test from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfterSeconds, providerFailureCooldown, MAX_RETRY_AFTER_SECONDS } from "../src/v5-modules/provider-policy.mjs";
import { classifyProviderFailure } from "../src/v5-modules/failure-classification.mjs";
import { providerCircuitDecision, PROVIDER_CIRCUIT_FAILURE_THRESHOLD, PROVIDER_CIRCUIT_OPEN_MS } from "../src/v5-modules/provider-circuit-breaker.mjs";
import { listAgents, getAgent, selectTaskAgents, AGENT_REGISTRY_POLICY } from "../src/v5-modules/agent-registry.mjs";

// 20 deterministic boundary/defensive tests. No network, provider keys, timers, or paid services.
test("Retry-After accepts a numeric zero", () => {
  assert.equal(parseRetryAfterSeconds("0", 0), 0);
});
test("Retry-After trims surrounding whitespace", () => {
  assert.equal(parseRetryAfterSeconds(" 12 ", 0), 12);
});
test("Retry-After rejects empty input", () => {
  assert.equal(parseRetryAfterSeconds("   ", 0), null);
});
test("Retry-After rejects null and undefined", () => {
  assert.equal(parseRetryAfterSeconds(null, 0), null);
  assert.equal(parseRetryAfterSeconds(undefined, 0), null);
});
test("Retry-After rejects non-finite reference time", () => {
  assert.equal(parseRetryAfterSeconds("12", Number.NaN), null);
  assert.equal(parseRetryAfterSeconds("12", Infinity), null);
});
test("Retry-After clamps to a caller-supplied safe cap", () => {
  assert.equal(parseRetryAfterSeconds("90", 0, 30), 30);
});
test("Retry-After refuses an invalid negative cap and uses global cap", () => {
  assert.equal(parseRetryAfterSeconds("90", 0, -1), 90);
});
test("Retry-After HTTP date in the past becomes zero", () => {
  assert.equal(parseRetryAfterSeconds("Thu, 01 Jan 1970 00:00:00 GMT", 1000), 0);
});
test("Retry-After HTTP date is rounded up to the next whole second", () => {
  assert.equal(parseRetryAfterSeconds("Thu, 01 Jan 1970 00:00:02 GMT", 1001), 1);
});
test("Retry-After date-shaped but invalid date is rejected", () => {
  assert.equal(parseRetryAfterSeconds("Mon, 99 Foo 2026 25:61:61 GMT", 0), null);
});
test("429 cooldown has a minimum delay", () => {
  assert.deepEqual(providerFailureCooldown({ status: 429, retryAfterSeconds: 0 }), {
    ttl: 60, reason: "rate_limited",
  });
});
test("429 cooldown never exceeds one day", () => {
  assert.deepEqual(providerFailureCooldown({ status: 429, retryAfterSeconds: 9999999 }), {
    ttl: MAX_RETRY_AFTER_SECONDS, reason: "rate_limited",
  });
});
test("explicit quota exhaustion overrides HTTP status cooldown", () => {
  assert.deepEqual(providerFailureCooldown({ status: 503, quotaExhausted: true }), {
    ttl: 21600, reason: "quota_exhausted",
  });
});
test("client errors other than auth, rate-limit and missing-model have no cooldown", () => {
  for (const status of [400, 405, 409, 422]) {
    assert.equal(providerFailureCooldown({ status }), null);
  }
});
test("failure classifier treats 408 as timeout and retryable", () => {
  const result = classifyProviderFailure({ status: 408 });
  assert.equal(result.classification, "timeout");
  assert.equal(result.retryable, true);
});
test("failure classifier treats ordinary 4xx as request error and not retryable", () => {
  const result = classifyProviderFailure({ status: 422 });
  assert.equal(result.classification, "request_error");
  assert.equal(result.retryable, false);
});
test("failure classifier marks empty response retryable without leaking message", () => {
  const result = classifyProviderFailure({ status: 200, message: "empty response; secret=sk-test" });
  assert.equal(result.classification, "empty_response");
  assert.equal(result.retryable, true);
  assert.equal(JSON.stringify(result).includes("sk-test"), false);
});
test("circuit is closed when there is no health record", () => {
  assert.deepEqual(providerCircuitDecision(null, 1000), {
    state: "closed", consecutiveFailures: 0, retryInMs: 0,
  });
});
test("circuit is closed for future-dated health records", () => {
  const now = 10000;
  assert.equal(providerCircuitDecision({
    consecutiveFailures: PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
    lastStatusCode: 503, lastFailureClass: "server_error", lastFailureAt: now + 1,
  }, now).state, "closed");
});
test("circuit opens for exactly the configured threshold", () => {
  const now = 1000000;
  assert.equal(providerCircuitDecision({
    consecutiveFailures: PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
    lastStatusCode: 503, lastFailureClass: "server_error", lastFailureAt: now - 1,
  }, now).state, "open");
});
test("circuit is half-open exactly at the recovery boundary", () => {
  const now = 1000000;
  assert.equal(providerCircuitDecision({
    consecutiveFailures: PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
    lastStatusCode: 503, lastFailureClass: "server_error",
    lastFailureAt: now - PROVIDER_CIRCUIT_OPEN_MS,
  }, now).state, "half_open");
});
test("agent listing returns defensive copies of task type arrays", () => {
  const first = listAgents();
  first[0].taskTypes.push("unsafe-test-value");
  assert.equal(listAgents()[0].taskTypes.includes("unsafe-test-value"), false);
});
test("agent lookup returns null for an unknown identifier", () => {
  assert.equal(getAgent("unknown-agent"), null);
});
test("agent lookup does not mutate registry when returned data is edited", () => {
  const agent = getAgent("qa-agent");
  agent.taskTypes.push("unsafe-test-value");
  assert.equal(getAgent("qa-agent").taskTypes.includes("unsafe-test-value"), false);
});
test("agent policy explicitly disables execution, external actions and paid services", () => {
  assert.equal(AGENT_REGISTRY_POLICY.execution_enabled, false);
  assert.equal(AGENT_REGISTRY_POLICY.external_actions_enabled, false);
  assert.equal(AGENT_REGISTRY_POLICY.paid_services_enabled, false);
});
test("agent selection with a one-agent cap returns exactly one agent", () => {
  assert.equal(selectTaskAgents("seo", { maxAgents: 1 }).length, 1);
});
test("agent selection rejects fractional and non-numeric caps", () => {
  assert.throws(() => selectTaskAgents("seo", { maxAgents: 1.5 }), RangeError);
  assert.throws(() => selectTaskAgents("seo", { maxAgents: "2" }), RangeError);
});
test("unknown agent task type is rejected without a fallback route", () => {
  assert.throws(() => selectTaskAgents("payment-execution"), TypeError);
});
