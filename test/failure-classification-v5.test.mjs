import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure } from "../src/v5-modules/failure-classification.mjs";
import { providerCircuitDecision, PROVIDER_CIRCUIT_OPEN_MS } from "../src/v5-modules/provider-circuit-breaker.mjs";

test("classifies transient failures and permits circuit protection", () => {
  const cases = [[0, "fetch failed", "network_error"], [408, "request timed out", "timeout"], [503, "upstream unavailable", "server_error"], [200, "Prazan odgovor", "empty_response"]];
  for (const [status, message, expected] of cases) {
    const result = classifyProviderFailure({ status, message });
    assert.equal(result.classification, expected);
    assert.equal(result.retryable, true);
  }
});

test("separates quota, rate-limit, auth, model and client errors", () => {
  const cases = [[{status:429}, "rate_limited", false, "rate_limited"], [{status:401}, "auth_or_policy", false, "provider_auth_or_policy"], [{status:403}, "auth_or_policy", false, "provider_auth_or_policy"], [{status:404}, "model_unavailable", false, "provider_model_unavailable"], [{status:400}, "request_error", false, null], [{status:429, quotaExhausted:true}, "quota_exhausted", false, "quota_exhausted"]];
  for (const [input, expected, retryable, cooldown] of cases) {
    const result = classifyProviderFailure(input);
    assert.equal(result.classification, expected);
    assert.equal(result.retryable, retryable);
    assert.equal(result.cooldownReason, cooldown);
  }
});

test("bounds Retry-After using existing provider policy", () => {
  assert.equal(classifyProviderFailure({status:429, retryAfterSeconds:999999999}).cooldownSeconds, 86400);
});

test("only transient classes open circuit; recovery permits half-open probe", () => {
  const now = 10000000;
  const health = (lastFailureClass, lastStatusCode) => ({consecutiveFailures:5, lastFailureClass, lastStatusCode, lastFailureAt:now-100});
  assert.equal(providerCircuitDecision(health("server_error",503), now).state, "open");
  assert.equal(providerCircuitDecision(health("network_error",0), now).state, "open");
  for (const [kind, code] of [["auth_or_policy",401], ["rate_limited",429], ["model_unavailable",404]]) assert.equal(providerCircuitDecision(health(kind,code), now).state, "closed");
  assert.equal(providerCircuitDecision(health("server_error",503), now + PROVIDER_CIRCUIT_OPEN_MS).state, "half_open");
});

test("classification output never includes raw provider error text", () => {
  const result = classifyProviderFailure({status:503, message:"private detail API key=secret"});
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
