import test from 'node:test';
import assert from 'node:assert/strict';
import { safeIntegrationError, safeIntegrationHttpStatus } from '../src/integrations/safe-error.mjs';
import { validatePublicPageUrl, fetchPublicHtml } from '../src/audit/public-page.mjs';
import { getIntegrationReadiness } from '../src/integrations/registry.mjs';

test('all public integration error codes are stable and bounded', () => {
  const allowed = [
    'INTEGRATION_TIMEOUT', 'INTEGRATION_UNAVAILABLE',
    'INTEGRATION_INVALID_RESPONSE', 'INTEGRATION_NOT_CONFIGURED',
    'INTEGRATION_NOT_IMPLEMENTED', 'INTEGRATION_RATE_LIMITED',
  ];
  for (const code of allowed) {
    assert.deepEqual(safeIntegrationError({ code, message: 'private detail' }), { ok: false, code });
  }
  assert.deepEqual(safeIntegrationError({ code: 'UNKNOWN', status: 500 }), { ok: false, code: 'INTEGRATION_UNAVAILABLE' });
});

test('HTTP status mapping is exhaustive across standard status range', () => {
  for (let status = 100; status <= 599; status++) {
    const result = safeIntegrationHttpStatus(status);
    assert.equal(typeof result.ok, 'boolean', String(status));
    assert.equal(typeof result.code, 'string', String(status));
    assert.equal(Object.keys(result).sort().join(','), 'code,ok', String(status));
    if (status >= 200 && status < 300) assert.deepEqual(result, { ok: true, code: 'INTEGRATION_OK' });
    else if (status === 408 || status === 504) assert.equal(result.code, 'INTEGRATION_TIMEOUT');
    else if (status === 429) assert.equal(result.code, 'INTEGRATION_RATE_LIMITED');
    else assert.equal(result.ok, false);
  }
});

test('error normalizer ignores misleading message and stack fields', () => {
  const result = safeIntegrationError({
    name: 'Error',
    message: 'https://internal.example/?token=secret',
    stack: 'Bearer super-secret',
    response: { body: 'private customer data' },
    status: 502,
  });
  assert.deepEqual(result, { ok: false, code: 'INTEGRATION_UNAVAILABLE' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('customer'), false);
});

test('public URL validation blocks alternate numeric IPv4 and IPv6 literals', () => {
  const blocked = [
    'http://2130706433',
    'http://0177.0.0.1',
    'http://0x7f000001',
    'http://192.168.1.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fc00::1]',
    'http://metadata',
    'http://service.example.invalid',
  ];
  for (const url of blocked) assert.equal(validatePublicPageUrl(url).ok, false, url);
});

test('public URL validator rejects overlong and malformed inputs without throwing', () => {
  for (const url of [null, {}, '', 'https://', 'https://example.com:65536', 'x'.repeat(2049)]) {
    assert.doesNotThrow(() => validatePublicPageUrl(url));
    assert.equal(validatePublicPageUrl(url).ok, false);
  }
});

test('fetch never follows blocked redirects and never returns credential-bearing redirect URLs', async () => {
  for (const location of [
    'https://user:pass@evil.example/path',
    'file:///etc/passwd',
    'http://192.168.1.10/admin',
    'https://evil.example:9443/private',
  ]) {
    let calls = 0;
    const result = await fetchPublicHtml('https://example.com/start', {
      fetchImpl: async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location } });
      },
    });
    assert.equal(result.ok, false, location);
    assert.equal(calls, 1, location);
    assert.equal(JSON.stringify(result).includes('pass@'), false, location);
  }
});

test('fetch returns stable codes for 401, 403, 404, 429 and 5xx without body leakage', async () => {
  for (const status of [401, 403, 404, 429, 500, 502, 503, 599]) {
    const result = await fetchPublicHtml('https://example.com', {
      fetchImpl: async () => new Response('private token=abc', { status }),
    });
    assert.equal(result.ok, false, String(status));
    assert.equal(result.status, status, String(status));
    assert.equal(JSON.stringify(result).includes('private'), false, String(status));
    assert.equal(JSON.stringify(result).includes('token=abc'), false, String(status));
  }
});

test('integration readiness remains disabled under all supported opt-in-looking values', () => {
  for (const value of ['true', 'TRUE', '1', 'yes', true, 1, ' true ', null]) {
    const status = getIntegrationReadiness('crawl4ai', {
      CEOAI_CRAWL4AI_ENABLED: value,
      CEOAI_CRAWL4AI_URL: 'https://crawler.example.com/api',
      CEOAI_CRAWL4AI_TOKEN: 'never-echo-this',
    });
    assert.equal(status.enabled, false, String(value));
    assert.equal(JSON.stringify(status).includes('never-echo-this'), false);
  }
});

test('URL query and fragment do not change the fetch destination identity', async () => {
  let requested;
  const result = await fetchPublicHtml('https://example.com/page#section', {
    fetchImpl: async (url) => {
      requested = url;
      return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(requested, 'https://example.com/page');
});

test('body limit rejects exact overrun and does not return partial HTML', async () => {
  const result = await fetchPublicHtml('https://example.com', {
    maxBytes: 1024,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(1024)));
        controller.enqueue(new TextEncoder().encode('b'));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(result, { ok: false, code: 'HTML_TOO_LARGE' });
});
