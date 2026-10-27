import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RETRY_AFTER_SECONDS, parseRetryAfterSeconds, providerFailureCooldown } from "../src/v5-modules/provider-policy.mjs";

test("Retry-After accepts bounded delta seconds", () => {
  assert.equal(parseRetryAfterSeconds("120", 0), 120);
  assert.equal(parseRetryAfterSeconds("999999", 0), MAX_RETRY_AFTER_SECONDS);
  assert.equal(parseRetryAfterSeconds("-1", 0), null);
  assert.equal(parseRetryAfterSeconds("1.5", 0), null);
});

test("Retry-After accepts HTTP dates and clamps past dates to zero", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfterSeconds("Thu, 01 Jan 2026 00:02:00 GMT", now), 120);
  assert.equal(parseRetryAfterSeconds("Wed, 31 Dec 2025 23:59:00 GMT", now), 0);
  assert.equal(parseRetryAfterSeconds("not-a-date", now), null);
});

test("quota exhaustion takes precedence over generic rate limit hints", () => {
  assert.deepEqual(providerFailureCooldown({ status: 429, quotaExhausted: true, retryAfterSeconds: 5 }), {
    ttl: 21600, reason: "quota_exhausted",
  });
});

test("429 honors Retry-After but always applies a minimum cooldown", () => {
  assert.deepEqual(providerFailureCooldown({ status: 429, retryAfterSeconds: 5 }), {
    ttl: 60, reason: "rate_limited",
  });
  assert.deepEqual(providerFailureCooldown({ status: 429, retryAfterSeconds: 180 }), {
    ttl: 180, reason: "rate_limited",
  });
  assert.equal(providerFailureCooldown({ status: 429, retryAfterSeconds: 999999 }).ttl, MAX_RETRY_AFTER_SECONDS);
});

test("bad credentials, missing models, server errors and network failures cool down briefly", () => {
  assert.deepEqual(providerFailureCooldown({ status: 401 }), { ttl: 3600, reason: "provider_auth_or_policy" });
  assert.deepEqual(providerFailureCooldown({ status: 403 }), { ttl: 3600, reason: "provider_auth_or_policy" });
  assert.deepEqual(providerFailureCooldown({ status: 404 }), { ttl: 21600, reason: "provider_model_unavailable" });
  assert.deepEqual(providerFailureCooldown({ status: 503 }), { ttl: 300, reason: "provider_server_error" });
  assert.deepEqual(providerFailureCooldown({ status: 0 }), { ttl: 60, reason: "provider_timeout_or_network" });
  assert.equal(providerFailureCooldown({ status: 400 }), null);
});

test("cooldown policy rejects unvalidated Retry-After values", () => {
  assert.equal(providerFailureCooldown({ status: 429, retryAfterSeconds: Infinity }).ttl, 60);
  assert.equal(providerFailureCooldown({ status: 429, retryAfterSeconds: -10 }).ttl, 60);
  assert.equal(providerFailureCooldown({ status: 429, retryAfterSeconds: "999999" }).ttl, 60);
});

test("Retry-After HTTP dates are capped at the same 24-hour policy limit", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(
    parseRetryAfterSeconds("Sat, 03 Jan 2026 00:00:00 GMT", now),
    MAX_RETRY_AFTER_SECONDS,
  );
  assert.equal(
    parseRetryAfterSeconds("Fri, 02 Jan 2026 00:00:00 GMT", now),
    MAX_RETRY_AFTER_SECONDS,
  );
});

test("Retry-After parsing rejects non-canonical date and numeric formats", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  for (const value of ["1e3", "+30", "30 seconds", "Thu, 1 Jan 2026 00:02:00 GMT", "Thu, 01 Jan 2026 00:02:00 UTC"]) {
    assert.equal(parseRetryAfterSeconds(value, now), null, `reject malformed Retry-After: ${value}`);
  }
});

test("provider cooldown classification handles boundary status codes conservatively", () => {
  assert.equal(providerFailureCooldown({ status: 499 }), null);
  assert.deepEqual(providerFailureCooldown({ status: 500 }), { ttl: 300, reason: "provider_server_error" });
  assert.deepEqual(providerFailureCooldown({ status: 599 }), { ttl: 300, reason: "provider_server_error" });
  assert.deepEqual(providerFailureCooldown({ status: 429, retryAfterSeconds: 0 }), { ttl: 60, reason: "rate_limited" });
});

test("Retry-After parser keeps custom caps non-negative and bounded", () => {
  assert.equal(parseRetryAfterSeconds("120", 0, 0), 0);
  assert.equal(parseRetryAfterSeconds("120", 0, -1), 120);
  assert.equal(parseRetryAfterSeconds("120", 0, NaN), 120);
  assert.equal(parseRetryAfterSeconds("120", 0, Infinity), 120);
  assert.equal(parseRetryAfterSeconds("120", NaN), null);
});
