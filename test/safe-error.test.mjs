import test from 'node:test';
import assert from 'node:assert/strict';
import { safeIntegrationError, safeIntegrationHttpStatus } from '../src/integrations/safe-error.mjs';

test('maps timeout and rate-limit failures to stable codes', () => {
  assert.deepEqual(safeIntegrationError({ name: 'AbortError', message: 'secret url and token' }), { ok: false, code: 'INTEGRATION_TIMEOUT' });
  assert.deepEqual(safeIntegrationError({ status: 429, message: 'private upstream body' }), { ok: false, code: 'INTEGRATION_RATE_LIMITED' });
  assert.deepEqual(safeIntegrationError({ status: 504 }), { ok: false, code: 'INTEGRATION_TIMEOUT' });
});

test('allows only known public error codes and never echoes arbitrary text', () => {
  const result = safeIntegrationError({ code: 'https://private.example/path?token=secret', message: 'secret', stack: 'secret' }, 'NOT_SAFE');
  assert.deepEqual(result, { ok: false, code: 'INTEGRATION_UNAVAILABLE' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.deepEqual(safeIntegrationError({ code: 'INTEGRATION_INVALID_RESPONSE', message: 'leak' }), { ok: false, code: 'INTEGRATION_INVALID_RESPONSE' });
});

test('invalid inputs and unsafe fallback values fail closed', () => {
  assert.deepEqual(safeIntegrationError('token=abc'), { ok: false, code: 'INTEGRATION_UNAVAILABLE' });
  assert.deepEqual(safeIntegrationError(null, 'token=abc'), { ok: false, code: 'INTEGRATION_UNAVAILABLE' });
});

test('HTTP status mapper handles success, errors and invalid statuses', () => {
  assert.deepEqual(safeIntegrationHttpStatus(200), { ok: true, code: 'INTEGRATION_OK' });
  assert.deepEqual(safeIntegrationHttpStatus(429), { ok: false, code: 'INTEGRATION_RATE_LIMITED' });
  assert.deepEqual(safeIntegrationHttpStatus(408), { ok: false, code: 'INTEGRATION_TIMEOUT' });
  assert.deepEqual(safeIntegrationHttpStatus(503), { ok: false, code: 'INTEGRATION_UNAVAILABLE' });
  assert.deepEqual(safeIntegrationHttpStatus(99), { ok: false, code: 'INTEGRATION_INVALID_RESPONSE' });
  assert.deepEqual(safeIntegrationHttpStatus('200'), { ok: false, code: 'INTEGRATION_INVALID_RESPONSE' });
});
