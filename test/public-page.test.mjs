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

test('fetch result never echoes query parameters or fragments from the requested URL', async () => {
  const success = await fetchPublicHtml('https://example.com/private?token=topsecret&session=abc#fragment', {
    fetchImpl: async (url) => {
      assert.equal(url, 'https://example.com/private?token=topsecret&session=abc');
      return new Response('<title>OK</title>', { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(success.ok, true);
  assert.equal(success.finalUrl, 'https://example.com/private');
  assert.equal(JSON.stringify(success).includes('topsecret'), false);
  assert.equal(JSON.stringify(success).includes('session=abc'), false);
  assert.equal(JSON.stringify(success).includes('fragment'), false);
});

test('HTTP error result strips URL query secrets and fragments', async () => {
  const result = await fetchPublicHtml('https://example.com/audit-123?api_key=hidden#internal', {
    fetchImpl: async () => new Response('upstream body is private', { status: 503 }),
  });
  assert.equal(result.code, 'HTTP_ERROR');
  assert.equal(result.finalUrl, 'https://example.com/audit-123');
  assert.equal(JSON.stringify(result).includes('hidden'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('observation report sanitizes pageUrl query and fragment', () => {
  const result = extractHtmlObservations('<title>Example</title>', 'https://example.com/path?token=secret#frag');
  assert.equal(result.pageUrl, 'https://example.com/path');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('frag'), false);
});

test('redirect responses without location return a stable error', async () => {
  const result = await fetchPublicHtml('https://example.com/start', {
    fetchImpl: async () => new Response(null, { status: 302 }),
  });
  assert.deepEqual(result, { ok: false, code: 'REDIRECT_WITHOUT_LOCATION' });
});

test('unsupported redirect status is treated as a non-success HTTP response', async () => {
  const result = await fetchPublicHtml('https://example.com/start', {
    fetchImpl: async () => new Response(null, { status: 300 }),
  });
  assert.equal(result.code, 'HTTP_ERROR');
  assert.equal(result.status, 300);
});


test('canonical observation strips query parameters and fragments', () => {
  const html = '<link rel="canonical" href="https://example.com/canonical?token=secret#private">';
  const result = extractHtmlObservations(html, 'https://example.com/page');
  assert.equal(result.canonical.value, 'https://example.com/canonical');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('redirect limit allows exactly three redirects and rejects a fourth', async () => {
  let calls = 0;
  const accepted = await fetchPublicHtml('https://example.com/0', {
    fetchImpl: async (url) => {
      calls++;
      const n = Number(url.split('/').pop());
      if (n < 3) return new Response(null, { status: 302, headers: { location: '/' + (n + 1) } });
      return new Response('<title>OK</title>', { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(accepted.ok, true);
  assert.equal(calls, 4);
  calls = 0;
  const rejected = await fetchPublicHtml('https://example.com/0', {
    fetchImpl: async (url) => {
      calls++;
      const n = Number(url.split('/').pop());
      return new Response(null, { status: 302, headers: { location: '/' + (n + 1) } });
    },
  });
  assert.equal(rejected.code, 'TOO_MANY_REDIRECTS');
  assert.equal(calls, 4);
});

test('body read timeout is sanitized and does not leak upstream exception details', async () => {
  const result = await fetchPublicHtml('https://example.com', {
    timeoutMs: 250,
    fetchImpl: async () => new Response(new ReadableStream({
      pull() { return new Promise(() => {}); },
    }), { headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FETCH_TIMEOUT');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('missing content type is rejected and never treated as HTML', async () => {
  const result = await fetchPublicHtml('https://example.com', {
    fetchImpl: async () => new Response('<title>not trusted</title>'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONTENT_TYPE_NOT_HTML');
  assert.equal('html' in result, false);
});


test('body exactly at configured byte limit is accepted', async () => {
  const body = 'x'.repeat(1024);
  const result = await fetchPublicHtml('https://example.com/exact-limit', {
    maxBytes: 1024,
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/html', 'content-length': '1024' } }),
  });
  assert.equal(result.ok, true);
  assert.equal(new TextEncoder().encode(result.html).byteLength, 1024);
});

test('invalid content length cannot bypass streamed body limit', async () => {
  const result = await fetchPublicHtml('https://example.com/bad-length', {
    maxBytes: 1024,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(800));
        controller.enqueue(new Uint8Array(400));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/html', 'content-length': 'not-a-number' } }),
  });
  assert.deepEqual(result, { ok: false, code: 'HTML_TOO_LARGE' });
});

test('missing content type is rejected without returning HTML', async () => {
  const result = await fetchPublicHtml('https://example.com/no-type', {
    fetchImpl: async () => new Response('<title>not trusted</title>'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONTENT_TYPE_NOT_HTML');
  assert.equal('html' in result, false);
});


test('independent concurrent audit requests keep results isolated', async () => {
  const inputs = ['alpha', 'beta', 'gamma', 'delta'];
  const results = await Promise.all(inputs.map(async (name) => fetchPublicHtml(`https://example.com/${name}?token=hidden-${name}`, {
    fetchImpl: async (url) => {
      await new Promise(resolve => setTimeout(resolve, name.length % 2));
      return new Response(`<title>${new URL(url).pathname.slice(1)}</title>`, {
        headers: { 'content-type': 'text/html' },
      });
    },
  })));
  assert.deepEqual(results.map(result => result.ok), [true, true, true, true]);
  assert.deepEqual(results.map(result => result.html), inputs.map(name => `<title>${name}</title>`));
  for (const result of results) {
    assert.equal(JSON.stringify(result).includes('hidden-'), false);
  }
});

test('fetch rejection with sensitive exception details returns only stable code', async () => {
  const result = await fetchPublicHtml('https://example.com', {
    fetchImpl: async () => {
      const error = new Error('Authorization: Bearer super-secret-token at https://internal.example/?api_key=hidden');
      error.name = 'NetworkError';
      throw error;
    },
  });
  assert.deepEqual(result, { ok: false, code: 'FETCH_FAILED' });
  assert.equal(JSON.stringify(result).includes('super-secret'), false);
  assert.equal(JSON.stringify(result).includes('internal.example'), false);
  assert.equal(JSON.stringify(result).includes('hidden'), false);
});

test('URL validator rejects encoded and unusual host representations before fetch', async () => {
  const blocked = [
    'http://127.1/',
    'http://0/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'https://user%3Apass@example.com/',
    'javascript:alert(1)',
  ];
  for (const input of blocked) {
    let calls = 0;
    const result = await fetchPublicHtml(input, { fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
    assert.equal(result.ok, false, input);
    assert.equal(calls, 0, input);
  }
});


test('canonical URLs reject credentials, non-web schemes, and blocked hosts', () => {
  for (const href of [
    'https://user:password@example.com/private?token=secret',
    'javascript:alert(1)',
    'data:text/html,secret',
    'http://127.0.0.1/admin',
    'https://example.com/safe?token=secret#fragment',
  ]) {
    const result = extractHtmlObservations(`<link rel="canonical" href="${href}">`, 'https://example.com/page');
    if (href.includes('/safe')) assert.equal(result.canonical.value, 'https://example.com/safe');
    else assert.equal(result.canonical.value, null, href);
    assert.equal(JSON.stringify(result).includes('password'), false);
    assert.equal(JSON.stringify(result).includes('token=secret'), false);
  }
});

test('redirect response bodies are cancelled when target is rejected', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() { cancelled = true; },
  });
  const result = await fetchPublicHtml('https://example.com/start', {
    fetchImpl: async () => new Response(body, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REDIRECT_TARGET_BLOCKED');
  assert.equal(cancelled, true);
});

test('non-HTML response bodies are cancelled rather than left unread', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() { cancelled = true; },
  });
  const result = await fetchPublicHtml('https://example.com/not-html', {
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'application/octet-stream' } }),
  });
  assert.equal(result.code, 'CONTENT_TYPE_NOT_HTML');
  assert.equal(cancelled, true);
});


test('malformed redirect Location returns a stable sanitized result without throwing', async () => {
  let calls = 0;
  const result = await fetchPublicHtml('https://example.com/start', {
    fetchImpl: async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: 'http://[malformed' } });
    },
  });
  assert.deepEqual(result, { ok: false, code: 'REDIRECT_TARGET_BLOCKED', reason: 'URL_INVALID' });
  assert.equal(calls, 1);
});


test('streamed oversized HTML cancels the reader immediately', async () => {
  let cancelled = false;
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(chunks === 1 ? 800 : 400));
    },
    cancel() { cancelled = true; },
  });
  const result = await fetchPublicHtml('https://example.com/stream-limit', {
    maxBytes: 1024,
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(result, { ok: false, code: 'HTML_TOO_LARGE' });
  assert.equal(cancelled, true);
  assert.ok(chunks <= 3, `reader pulled ${chunks} chunks before cancellation`);
});

test('fragment is never sent in the actual HTTP request', async () => {
  let requested;
  const result = await fetchPublicHtml('https://example.com/path?visible=allowed#secret-fragment', {
    fetchImpl: async (url) => {
      requested = url;
      return new Response('<title>OK</title>', { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(requested, 'https://example.com/path?visible=allowed');
  assert.equal(JSON.stringify(result).includes('secret-fragment'), false);
});

test('URL validation rejects non-string and oversized input without network access', async () => {
  for (const input of [null, undefined, 42, {}, 'https://example.com/' + 'x'.repeat(2048)]) {
    assert.equal(validatePublicPageUrl(input).ok, false);
    let calls = 0;
    const result = await fetchPublicHtml(input, { fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  }
});

test('body read timeout cancels a stalled HTML stream and returns a stable code', async () => {
  let cancelled = false;
  let controllerRef;
  const body = new ReadableStream({
    start(controller) { controllerRef = controller; controller.enqueue(new TextEncoder().encode('<title>partial')); },
    cancel() { cancelled = true; },
  });
  const result = await fetchPublicHtml('https://example.com/stalled-body', {
    timeoutMs: 250,
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(result, { ok: false, code: 'FETCH_TIMEOUT' });
  assert.equal(cancelled, true);
});

test('invalid or misleading Content-Length cannot bypass the streamed byte cap', async () => {
  for (const declared of ['not-a-number', '-1', '0', '1e3']) {
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(700)); controller.enqueue(new Uint8Array(700)); controller.close(); },
    });
    const result = await fetchPublicHtml('https://example.com/content-length-edge', {
      maxBytes: 1024,
      fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/html', 'content-length': declared } }),
    });
    assert.equal(result.code, 'HTML_TOO_LARGE', declared);
  }
});

test('redirect chains stop after the configured maximum and do not fetch the next target', async () => {
  let calls = 0;
  const result = await fetchPublicHtml('https://example.com/r0', {
    fetchImpl: async (url) => {
      calls++;
      const n = Number(url.match(/r(\d+)$/)?.[1] ?? 0);
      return new Response(null, { status: 302, headers: { location: '/r' + (n + 1) } });
    },
  });
  assert.equal(result.code, 'TOO_MANY_REDIRECTS');
  assert.equal(calls, 4);
});
