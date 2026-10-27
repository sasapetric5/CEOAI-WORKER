import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLycheeReport } from '../src/integrations/lychee-result.mjs';

test('normalizes a minimal valid Lychee report', () => {
  const result = normalizeLycheeReport({ total: 3, successful: 2, fail_map: { 'https://example.com/bad': [{ url: 'https://example.com/bad', status: 404, message: 'Not Found' }] } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { total: 3, successful: 2, failed: 1, failureEntries: 1, returnedFailures: 1, truncatedFailures: 0, malformedFailures: 0 });
  assert.deepEqual(result.failures[0], { url: 'https://example.com/bad', status: '404', message: 'Not Found' });
});

test('accepts JSON string reports', () => {
  const result = normalizeLycheeReport(JSON.stringify({ total: 1, successful: 1, fail_map: {} }));
  assert.equal(result.ok, true);
  assert.equal(result.summary.successful, 1);
});

test('rejects invalid JSON without echoing raw input', () => {
  const result = normalizeLycheeReport('{ "token":"secret",');
  assert.deepEqual(result, { ok: false, code: 'LYCHEE_REPORT_INVALID_JSON' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('rejects reports over the configured hard byte limit', () => {
  const result = normalizeLycheeReport(' '.repeat(2_000_001));
  assert.deepEqual(result, { ok: false, code: 'LYCHEE_REPORT_TOO_LARGE' });
});

test('rejects null, primitive and array report shapes', () => {
  for (const input of [null, 1, true, [], 'null', '[]']) {
    assert.equal(normalizeLycheeReport(input).ok, false);
    assert.equal(normalizeLycheeReport(input).code, 'LYCHEE_REPORT_INVALID_SHAPE');
  }
});

test('rejects malformed fail_map shape', () => {
  assert.deepEqual(normalizeLycheeReport({ fail_map: [] }), { ok: false, code: 'LYCHEE_REPORT_INVALID_FAILURES' });
  assert.deepEqual(normalizeLycheeReport({ fail_map: 'not-an-object' }), { ok: false, code: 'LYCHEE_REPORT_INVALID_FAILURES' });
});

test('strips query strings and fragments that could leak tokens or tracking identifiers', () => {
  const result = normalizeLycheeReport({ fail_map: { x: [{ url: 'https://example.com/path?token=secret&user=private#section', status: 404 }] } });
  assert.equal(result.ok, true);
  assert.equal(result.failures[0].url, 'https://example.com/path');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('rejects credential-bearing, non-web, malformed and oversized failure URLs', () => {
  const urls = [
    'https://user:pass@example.com/path',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a URL',
    'https://' + 'a'.repeat(2100) + '.com',
  ];
  const result = normalizeLycheeReport({ fail_map: { group: urls.map(url => ({ url, status: 500 })) } });
  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.summary.malformedFailures, urls.length);
});

test('ignores unknown upstream fields and never returns them', () => {
  const result = normalizeLycheeReport({ total: 1, successful: 1, apiKey: 'super-secret', internalStack: 'sensitive', fail_map: {} });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('super-secret'), false);
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

test('rejects inconsistent successful and total counters', () => {
  assert.deepEqual(normalizeLycheeReport({ total: 2, successful: 3, fail_map: {} }), { ok: false, code: 'LYCHEE_REPORT_INCONSISTENT_COUNTS' });
});

test('rejects inconsistent failed and total counters', () => {
  assert.deepEqual(normalizeLycheeReport({ total: 2, failed: 3, fail_map: {} }), { ok: false, code: 'LYCHEE_REPORT_INCONSISTENT_COUNTS' });
});

test('does not trust negative, fractional or unsafe counters', () => {
  const result = normalizeLycheeReport({ total: -1, successful: 1.5, failed: Number.MAX_SAFE_INTEGER + 1, fail_map: {} });
  assert.equal(result.ok, true);
  assert.equal(result.summary.total, null);
  assert.equal(result.summary.successful, null);
  assert.equal(result.summary.failed, 0);
});

test('caps returned failures and reports truncation accurately', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ url: 'https://example.com/' + i, status: 404 }));
  const result = normalizeLycheeReport({ total: 20, failed: 20, fail_map: { failures: entries } }, { maxFailures: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 5);
  assert.equal(result.summary.truncatedFailures, 15);
});

test('hard cap prevents caller from increasing the failure limit beyond 500', () => {
  const entries = Array.from({ length: 510 }, (_, i) => ({ url: 'https://example.com/' + i }));
  const result = normalizeLycheeReport({ fail_map: { failures: entries } }, { maxFailures: 1000 });
  assert.equal(result.failures.length, 500);
  assert.equal(result.summary.truncatedFailures, 10);
});

test('malformed entries are counted and do not abort otherwise valid reports', () => {
  const result = normalizeLycheeReport({ fail_map: { failures: [null, 7, { url: 'ftp://example.com' }, { url: 'https://example.com', status: 404 }] } });
  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 1);
  assert.equal(result.summary.malformedFailures, 3);
});

test('sanitizes control characters and bounds upstream error text', () => {
  const message = 'bad\u0000\n' + 'x'.repeat(500);
  const result = normalizeLycheeReport({ fail_map: { failures: [{ url: 'https://example.com', message }] } });
  assert.equal(result.failures[0].message.length, 300);
  assert.equal(result.failures[0].message.includes('\u0000'), false);
  assert.equal(result.failures[0].message.includes('\n'), false);
});

test('supports failMap alias and common alternative field names', () => {
  const result = normalizeLycheeReport({ total: 1, success: 0, failMap: { 'https://example.com': [{ uri: 'https://example.com', status_code: '404 Not Found', reason: 'missing' }] } });
  assert.equal(result.ok, true);
  assert.equal(result.summary.successful, 0);
  assert.equal(result.failures[0].status, '404 Not Found');
  assert.equal(result.failures[0].message, 'missing');
});

test('failure entries are bounded by URL and text policies', () => {
  const result = normalizeLycheeReport({ fail_map: { 'https://example.com': [{ url: 'https://example.com', message: { arbitrary: 'object' }, status: { code: 503 } }] } });
  assert.equal(result.ok, true);
  assert.equal(result.failures[0].message, null);
  assert.equal(result.failures[0].status, '503');
});
