import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnlighthouseReport } from '../src/integrations/unlighthouse-result.mjs';

const fixture = () => ({
  lighthouseVersion: '12.2.0',
  fetchTime: '2026-10-27T10:00:00.000Z',
  requestedUrl: 'https://example.com/page?token=secret#section',
  finalDisplayedUrl: 'https://example.com/page?private=1#main',
  categories: {
    performance: { score: 0.91, title: 'Performance', secret: 'do-not-return' },
    accessibility: { score: 0.88, title: 'Accessibility' },
    seo: { score: 0.95, title: 'SEO' },
  },
  audits: {
    'largest-contentful-paint': { score: 0.9, numericValue: 1200.456, displayValue: '1.2 s', title: 'Largest Contentful Paint' },
    'total-blocking-time': { score: 0.8, numericValue: 150, displayValue: '150 ms', title: 'Total Blocking Time' },
    'unapproved-audit': { score: 0, details: { token: 'secret' } },
  },
  runtimeError: 'private stack trace',
});

test('normalizes an allowlisted Lighthouse report and strips URL secrets', () => {
  const result = normalizeUnlighthouseReport(fixture());
  assert.equal(result.ok, true);
  assert.equal(result.source, 'LIGHTHOUSE_JSON');
  assert.equal(result.requestedUrl, 'https://example.com/page');
  assert.equal(result.finalUrl, 'https://example.com/page');
  assert.equal(result.categories.performance.score, 91);
  assert.equal(result.categories.accessibility.score, 88);
  assert.equal(result.metrics['largest-contentful-paint'].numericValue, 1200.46);
  assert.equal(result.metrics['total-blocking-time'].displayValue, '150 ms');
  const serialized = JSON.stringify(result);
  for (const secret of ['secret', 'private', 'runtimeError', 'unapproved-audit']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('accepts a JSON string and a wrapped lighthouseResult', () => {
  const result = normalizeUnlighthouseReport(JSON.stringify({ lighthouseResult: fixture() }));
  assert.equal(result.ok, true);
  assert.equal(result.lighthouseVersion, '12.2.0');
});

test('rejects invalid JSON without echoing input', () => {
  assert.deepEqual(normalizeUnlighthouseReport('{"token":"secret",'), {
    ok: false, code: 'UNLIGHTHOUSE_REPORT_INVALID_JSON',
  });
});

test('rejects reports larger than the hard byte limit', () => {
  assert.deepEqual(normalizeUnlighthouseReport(' '.repeat(5_000_001)), {
    ok: false, code: 'UNLIGHTHOUSE_REPORT_TOO_LARGE',
  });
});

test('rejects primitive, array, and incomplete report shapes', () => {
  for (const input of [null, 1, true, [], 'null', '[]', {}, { categories: {}, audits: {} }]) {
    assert.equal(normalizeUnlighthouseReport(input).ok, false);
    assert.equal(normalizeUnlighthouseReport(input).code, 'UNLIGHTHOUSE_REPORT_INVALID_SHAPE');
  }
});

test('rejects credential-bearing and non-web target URLs and bounds invalid scores', () => {
  const input = fixture();
  input.requestedUrl = 'https://user:pass@example.com/path';
  input.finalDisplayedUrl = 'file:///etc/passwd';
  input.categories.performance.score = 2;
  input.audits['largest-contentful-paint'].numericValue = -1;
  const result = normalizeUnlighthouseReport(input);
  assert.equal(result.ok, true);
  assert.equal(result.requestedUrl, null);
  assert.equal(result.finalUrl, null);
  assert.equal(result.categories.performance.score, null);
  assert.equal(result.metrics['largest-contentful-paint'].numericValue, null);
});

test('never returns arbitrary upstream fields or unsafe audit identifiers', () => {
  const result = normalizeUnlighthouseReport(fixture());
  assert.equal(Object.hasOwn(result, 'runtimeError'), false);
  assert.equal(Object.hasOwn(result.metrics, 'unapproved-audit'), false);
});
