import test from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfterSeconds, providerFailureCooldown } from "../src/v5-modules/provider-policy.mjs";
import { classifyProviderFailure } from "../src/v5-modules/failure-classification.mjs";
import { providerCircuitDecision } from "../src/v5-modules/provider-circuit-breaker.mjs";
import { selectTaskAgents } from "../src/v5-modules/agent-registry.mjs";

// Fast, deterministic policy tests: no network, credentials, timers, or paid API calls.
test("provider timeout is retryable and exposes only a stable classification", () => {
  assert.deepEqual(classifyProviderFailure({ status: 0, message: "private endpoint and token timeout" }), {
    classification: "timeout", retryable: true, cooldownReason: "provider_timeout_or_network", cooldownSeconds: 60,
  });
});

test("network errors are retryable without exposing raw error messages", () => {
  const result = classifyProviderFailure({ status: 0, message: "secret key sk-test must not escape" });
  assert.equal(result.classification, "network_error");
  assert.equal(result.retryable, true);
  assert.equal(JSON.stringify(result).includes("sk-test"), false);
});

test("provider server failures are retryable and receive bounded cooldown", () => {
  for (const status of [500, 502, 503, 504, 599]) {
    const result = classifyProviderFailure({ status, message: "upstream failure" });
    assert.equal(result.classification, "server_error");
    assert.equal(result.retryable, true);
    assert.equal(result.cooldownSeconds, 300);
  }
});

test("quota exhaustion is non-retryable on the exhausted provider", () => {
  const result = classifyProviderFailure({ status: 429, quotaExhausted: true, retryAfterSeconds: 1 });
  assert.equal(result.classification, "quota_exhausted");
  assert.equal(result.retryable, false);
  assert.equal(result.cooldownSeconds, 21600);
});

test("authentication and policy failures do not trigger blind retry", () => {
  for (const status of [401, 403]) {
    const result = classifyProviderFailure({ status, message: "credentials redacted" });
    assert.equal(result.classification, "auth_or_policy");
    assert.equal(result.retryable, false);
    assert.equal(result.cooldownSeconds, 3600);
  }
});

test("missing model is classified separately and not blindly retried", () => {
  const result = classifyProviderFailure({ status: 404 });
  assert.equal(result.classification, "model_unavailable");
  assert.equal(result.retryable, false);
  assert.equal(result.cooldownSeconds, 21600);
});

test("malformed Retry-After input cannot create an unbounded delay", () => {
  for (const value of ["-1", "1e9", "NaN", "tomorrow", "999999999999999999999"]) {
    assert.equal(parseRetryAfterSeconds(value, 0), null, value);
  }
});

test("Retry-After numeric values are clamped to one day", () => {
  assert.equal(parseRetryAfterSeconds("999999", 0), 86400);
  assert.equal(parseRetryAfterSeconds("0", 0), 0);
});

test("circuit stays closed below transient failure threshold", () => {
  const now = 100000;
  assert.deepEqual(providerCircuitDecision({
    consecutiveFailures: 2, lastStatusCode: 503, lastFailureClass: "server_error", lastFailureAt: now - 1000,
  }, now), { state: "closed", consecutiveFailures: 2, retryInMs: 0 });
});

test("circuit opens after repeated transient failures", () => {
  const now = 100000;
  const result = providerCircuitDecision({
    consecutiveFailures: 3, lastStatusCode: 503, lastFailureClass: "server_error", lastFailureAt: now - 1000,
  }, now);
  assert.equal(result.state, "open");
  assert.equal(result.retryInMs, 299000);
});

test("circuit does not open for quota, auth, or model-policy failures", () => {
  const now = 100000;
  for (const [status, kind] of [[429, "rate_limited"], [401, "auth_or_policy"], [404, "model_unavailable"]]) {
    const result = providerCircuitDecision({
      consecutiveFailures: 9, lastStatusCode: status, lastFailureClass: kind, lastFailureAt: now - 1000,
    }, now);
    assert.equal(result.state, "closed", kind);
  }
});

test("circuit transitions to half-open only after its recovery window", () => {
  const now = 1000000;
  const result = providerCircuitDecision({
    consecutiveFailures: 3, lastStatusCode: 503, lastFailureClass: "server_error", lastFailureAt: now - 300000,
  }, now);
  assert.equal(result.state, "half_open");
  assert.equal(result.retryInMs, 0);
});

test("all planned agent handoffs remain capped and non-executing", () => {
  for (const taskType of ["coding", "research", "seo", "writing", "analysis", "general"]) {
    const agents = selectTaskAgents(taskType, { maxAgents: 3 });
    assert.ok(agents.length >= 1 && agents.length <= 3);
    assert.ok(agents.every(agent => agent.execution_allowed === false));
    assert.ok(agents.every(agent => agent.external_actions_allowed === false));
    assert.ok(agents.every(agent => agent.paid_services_allowed === false));
  }
});

test("agent registry rejects limits above the safe maximum", () => {
  assert.throws(() => selectTaskAgents("coding", { maxAgents: 5 }), RangeError);
  assert.throws(() => selectTaskAgents("coding", { maxAgents: 0 }), RangeError);
});

test("unsupported task type is rejected rather than routed arbitrarily", () => {
  assert.throws(() => selectTaskAgents("run-shell-command"), TypeError);
});
