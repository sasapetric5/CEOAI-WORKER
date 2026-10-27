import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicPageUrl, fetchPublicHtml, extractHtmlObservations } from '../src/audit/public-page.mjs';

test('URL validation accepts a public web URL and strips fragments', () => {
  const r = validatePublicPageUrl('https://example.com/path#section');
  assert.equal(r.ok, true); assert.equal(r.url.hash, '');
});
test('URL validation blocks non-web schemes, credentials, IP literals, local names and odd ports', () => {
  for (const url of ['file:///etc/passwd','ftp://example.com','https://user:pass@example.com','http://127.0.0.1','http://10.0.0.1','http://[::1]','http://localhost','http://foo.local','http://metadata.google.internal:8080'])
    assert.equal(validatePublicPageUrl(url).ok, false, url);
  assert.equal(validatePublicPageUrl('https://example.com:8443').code, 'URL_PORT_BLOCKED');
});
test('fetch sends manual redirects and blocks redirect to localhost before a second request', async () => {
  const calls = [];
  const result = await fetchPublicHtml('https://example.com/start', { fetchImpl: async (url, options) => {
    calls.push({ url, redirect: options.redirect });
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  }});
  assert.equal(result.ok, false); assert.equal(result.code, 'REDIRECT_TARGET_BLOCKED');
  assert.equal(calls.length, 1); assert.equal(calls[0].redirect, 'manual');
});
test('fetch follows a bounded same-public-host redirect and returns HTML only', async () => {
  const calls = [];
  const result = await fetchPublicHtml('https://example.com/a', { fetchImpl: async (url) => {
    calls.push(url);
    if (url.endsWith('/a')) return new Response(null, { status: 301, headers: { location: '/b' } });
    return new Response('<title>Example</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }});
  assert.equal(result.ok, true); assert.equal(result.finalUrl, 'https://example.com/b'); assert.equal(result.html, '<title>Example</title>'); assert.equal(calls.length, 2);
});
test('fetch rejects non-HTML, HTTP errors, excessive redirects and oversized declared body', async () => {
  const nonHtml = await fetchPublicHtml('https://example.com', { fetchImpl: async () => new Response('hi', { headers: { 'content-type': 'text/plain' } }) });
  assert.equal(nonHtml.code, 'CONTENT_TYPE_NOT_HTML');
  const httpError = await fetchPublicHtml('https://example.com', { fetchImpl: async () => new Response('no', { status: 503 }) });
  assert.equal(httpError.code, 'HTTP_ERROR'); assert.equal(httpError.status, 503);
  const large = await fetchPublicHtml('https://example.com', { maxBytes: 1024, fetchImpl: async () => new Response('x', { headers: { 'content-type': 'text/html', 'content-length': '99999' } }) });
  assert.equal(large.code, 'HTML_TOO_LARGE');
  const streamedLarge = await fetchPublicHtml('https://example.com', { maxBytes: 1024, fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(700)); controller.enqueue(new Uint8Array(700)); controller.close(); } }), { headers: { 'content-type': 'text/html' } }) });
  assert.equal(streamedLarge.code, 'HTML_TOO_LARGE');
  const loops = await fetchPublicHtml('https://example.com', { fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/loop' } }) });
  assert.equal(loops.code, 'TOO_MANY_REDIRECTS');
});
test('fetch converts network and abort errors into sanitized codes', async () => {
  const failed = await fetchPublicHtml('https://example.com', { fetchImpl: async () => { throw new Error('secret detail must not leak'); } });
  assert.deepEqual(failed, { ok: false, code: 'FETCH_FAILED' });
  const timeout = await fetchPublicHtml('https://example.com', { timeoutMs: 250, fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true })) });
  assert.equal(timeout.code, 'FETCH_TIMEOUT');
});
test('observation extractor measures actual HTML fields without inventing performance metrics', () => {
  const html = `<!doctype html><html><head><title>Demo &amp; Test</title><meta name="description" content="A real description"><link rel="canonical" href="/canonical"><meta name="robots" content="index,follow"><script type="application/ld+json">{"@type":"Organization"}</script><script type="application/ld+json">{bad}</script></head><body><h1>Heading</h1><h2>Second</h2><img src="/a.png"><img alt="Logo" src="/b.png"><a href="/inside">Inside</a><a href="https://other.example/x">Outside</a></body></html>`;
  const o = extractHtmlObservations(html, 'https://example.com/page');
  assert.equal(o.title.value, 'Demo & Test'); assert.equal(o.metaDescription.value, 'A real description');
  assert.equal(o.canonical.value, 'https://example.com/canonical'); assert.equal(o.robotsMeta.value, 'index,follow');
  assert.equal(o.headings.h1.length, 1); assert.equal(o.images.count, 2); assert.equal(o.images.missingAlt, 1);
  assert.equal(o.structuredData.jsonLdBlocks, 2); assert.equal(o.structuredData.validJsonLdBlocks, 1);
  assert.deepEqual(o.structuredData.types, ['Organization']); assert.equal(o.links.internal, 1); assert.equal(o.links.external, 1);
  assert.ok(o.notMeasuredHere.includes('Core Web Vitals')); assert.equal('performanceScore' in o, false);
});
test('malformed input URL fails without invoking network', async () => {
  let calls = 0;
  const result = await fetchPublicHtml('not a URL', { fetchImpl: async () => { calls++; throw new Error('should not run'); } });
  assert.equal(result.code, 'URL_INVALID'); assert.equal(calls, 0);
});

test('response body read remains under the same timeout budget', async () => {
  const result = await fetchPublicHtml('https://example.com', {
    timeoutMs: 250,
    fetchImpl: async () => new Response(new ReadableStream({
      pull() { return new Promise(() => {}); },
    }), { headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FETCH_TIMEOUT');
});

test('timeout, byte and URL option limits are clamped to safe bounds', async () => {
  let seenSignal;
  const result = await fetchPublicHtml('https://example.com', {
    timeoutMs: 999999,
    maxBytes: 999999999,
    fetchImpl: async (_url, options) => {
      seenSignal = options.signal;
      return new Response('<title>bounded</title>', { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seenSignal.aborted, false);
});

test('body stream failures return sanitized errors and release the reader', async () => {
  const result = await fetchPublicHtml('https://example.com', {
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('secret upstream token=abc')); },
    }), { headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(result, { ok: false, code: 'BODY_READ_FAILED' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('redirect response without a location fails without leaking URL details', async () => {
  const result = await fetchPublicHtml('https://example.com/start', {
    fetchImpl: async () => new Response(null, { status: 302 }),
  });
  assert.deepEqual(result, { ok: false, code: 'REDIRECT_WITHOUT_LOCATION' });
});

test('URL input and configured response-size limits reject oversized and malformed values', async () => {
  let calls = 0;
  const tooLong = await fetchPublicHtml('https://example.com/' + 'x'.repeat(2100), {
    fetchImpl: async () => { calls++; return new Response(''); },
  });
  assert.equal(tooLong.code, 'URL_INVALID');
  assert.equal(calls, 0);
  const invalidUrl = await fetchPublicHtml(null, { fetchImpl: async () => { calls++; return new Response(''); } });
  assert.equal(invalidUrl.code, 'URL_INVALID');
  assert.equal(calls, 0);
});
