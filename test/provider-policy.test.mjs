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
