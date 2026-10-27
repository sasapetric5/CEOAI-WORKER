import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfterSeconds, providerFailureCooldown, MAX_RETRY_AFTER_SECONDS } from '../src/v5-modules/provider-policy.mjs';

test('Retry-After accepts integer seconds and clamps extreme values', () => {
  assert.equal(parseRetryAfterSeconds('0'), 0);
  assert.equal(parseRetryAfterSeconds('60'), 60);
  assert.equal(parseRetryAfterSeconds(String(MAX_RETRY_AFTER_SECONDS + 100)), MAX_RETRY_AFTER_SECONDS);
  assert.equal(parseRetryAfterSeconds('9007199254740992'), null);
});

test('Retry-After rejects malformed and non-HTTP date strings', () => {
  for (const value of ['', '   ', '-1', '+5', '1.5', '1e3', 'tomorrow', 'Wed, 99 Foo 2026 25:61:61 GMT', 'NaN']) {
    assert.equal(parseRetryAfterSeconds(value, 0), null, JSON.stringify(value));
  }
  assert.equal(parseRetryAfterSeconds(null), null);
  assert.equal(parseRetryAfterSeconds(undefined), null);
});

test('Retry-After HTTP dates become non-negative seconds using the supplied clock', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(parseRetryAfterSeconds('Thu, 01 Jan 2026 00:00:30 GMT', now), 30);
  assert.equal(parseRetryAfterSeconds('Wed, 31 Dec 2025 23:59:30 GMT', now), 0);
});

test('provider cooldowns remain bounded and classify common failure types', () => {
  assert.deepEqual(providerFailureCooldown({ status: 429, retryAfterSeconds: 10 }), { ttl: 60, reason: 'rate_limited' });
  assert.deepEqual(providerFailureCooldown({ status: 429, retryAfterSeconds: MAX_RETRY_AFTER_SECONDS * 2 }), { ttl: MAX_RETRY_AFTER_SECONDS, reason: 'rate_limited' });
  assert.deepEqual(providerFailureCooldown({ status: 401 }), { ttl: 3600, reason: 'provider_auth_or_policy' });
  assert.deepEqual(providerFailureCooldown({ status: 404 }), { ttl: 21600, reason: 'provider_model_unavailable' });
  assert.deepEqual(providerFailureCooldown({ status: 503 }), { ttl: 300, reason: 'provider_server_error' });
  assert.deepEqual(providerFailureCooldown({ status: 0 }), { ttl: 60, reason: 'provider_timeout_or_network' });
  assert.deepEqual(providerFailureCooldown({ quotaExhausted: true, status: 429 }), { ttl: 21600, reason: 'quota_exhausted' });
  assert.equal(providerFailureCooldown({ status: 400 }), null);
});


test('Retry-After date parser rejects wrong casing, timezone, and impossible calendar dates safely', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(parseRetryAfterSeconds('Thu, 01 Jan 2026 00:01:00 PST', now), null);
  assert.equal(parseRetryAfterSeconds('thu, 01 Jan 2026 00:01:00 GMT', now), null);
  assert.equal(parseRetryAfterSeconds('Thu, 32 Jan 2026 00:01:00 GMT', now), null);
  assert.equal(parseRetryAfterSeconds('Thu, 01 Foo 2026 00:01:00 GMT', now), null);
});

test('Retry-After custom ceiling is respected for seconds and dates', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(parseRetryAfterSeconds('100', now, 30), 30);
  assert.equal(parseRetryAfterSeconds('Thu, 01 Jan 2026 00:02:00 GMT', now, 30), 30);
  assert.equal(parseRetryAfterSeconds('Thu, 01 Jan 2026 00:00:10 GMT', now, 30), 10);
});

test('cooldown policy never retries quota or rate-limited providers immediately', () => {
  assert.equal(providerFailureCooldown({ status: 429 }).ttl, 60);
  assert.equal(providerFailureCooldown({ status: 429, retryAfterSeconds: 0 }).ttl, 60);
  assert.equal(providerFailureCooldown({ status: 429, retryAfterSeconds: 3600 }).ttl, 3600);
  assert.equal(providerFailureCooldown({ quotaExhausted: true, status: 503 }).ttl, 21600);
});

test('cooldown policy avoids cooling down ordinary client input errors', () => {
  for (const status of [200, 201, 400, 405, 413, 422]) {
    assert.equal(providerFailureCooldown({ status }), null, `status ${status}`);
  }
});

test('cooldown policy applies stable bounded recovery windows to auth, model, server and network errors', () => {
  assert.deepEqual(providerFailureCooldown({ status: 401 }), { ttl: 3600, reason: 'provider_auth_or_policy' });
  assert.deepEqual(providerFailureCooldown({ status: 403 }), { ttl: 3600, reason: 'provider_auth_or_policy' });
  assert.deepEqual(providerFailureCooldown({ status: 404 }), { ttl: 21600, reason: 'provider_model_unavailable' });
  assert.deepEqual(providerFailureCooldown({ status: 500 }), { ttl: 300, reason: 'provider_server_error' });
  assert.deepEqual(providerFailureCooldown({ status: 599 }), { ttl: 300, reason: 'provider_server_error' });
  assert.deepEqual(providerFailureCooldown({ status: 0 }), { ttl: 60, reason: 'provider_timeout_or_network' });
});

test('invalid Retry-After values do not crash the cooldown classifier', () => {
  for (const retryAfterSeconds of [null, undefined, NaN, Infinity, -1, '3600', {}]) {
    const result = providerFailureCooldown({ status: 429, retryAfterSeconds });
    assert.equal(result.reason, 'rate_limited');
    assert.ok(Number.isSafeInteger(result.ttl));
    assert.ok(result.ttl >= 60 && result.ttl <= MAX_RETRY_AFTER_SECONDS);
  }
});


test('Retry-After parser rejects invalid clock and ceiling configuration', () => {
  for (const now of [NaN, Infinity, -Infinity, '0', null]) {
    assert.equal(parseRetryAfterSeconds('10', now), null);
  }
  for (const ceiling of [-1, 1.5, NaN, Infinity, '30', null]) {
    assert.equal(parseRetryAfterSeconds('10', 0, ceiling), null);
  }
  assert.equal(parseRetryAfterSeconds('10', 0, 0), 0);
});

test('Retry-After HTTP dates require the correct weekday and valid leap days', () => {
  const now = Date.UTC(2024, 0, 1, 0, 0, 0);
  assert.equal(parseRetryAfterSeconds('Fri, 29 Feb 2024 00:00:10 GMT', now), null);
  assert.equal(parseRetryAfterSeconds('Thu, 29 Feb 2024 00:00:10 GMT', now), MAX_RETRY_AFTER_SECONDS);
  assert.equal(parseRetryAfterSeconds('Thu, 29 Feb 2025 00:00:10 GMT', now), null);
  assert.equal(parseRetryAfterSeconds('Thu, 01 Jan 2026 24:00:00 GMT', now), null);
});
