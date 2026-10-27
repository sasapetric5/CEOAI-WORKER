/**
 * CEOAI public-page audit primitives — proposal only; not wired into the Worker.
 * No third-party API, credentials, browser automation, or writes to the target site.
 * Security note: hostname checks reduce obvious SSRF, but cannot guarantee that a
 * public hostname never resolves to a private IP. Production integration needs a
 * platform-enforced outbound egress policy / resolver-aware IP validation.
 */
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 8_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.invalid') ||
      host === 'metadata.google.internal' || host === 'metadata') return true;
  // Reject all IP literals in this first version rather than maintaining a fragile
  // allow/deny list for IPv4, IPv6, IPv4-mapped IPv6 and special-use ranges.
  if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

export function validatePublicPageUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return { ok: false, code: 'URL_INVALID' };
  let url;
  try { url = new URL(input); } catch { return { ok: false, code: 'URL_INVALID' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, code: 'URL_SCHEME_BLOCKED' };
  if (url.username || url.password) return { ok: false, code: 'URL_CREDENTIALS_BLOCKED' };
  if (url.port && url.port !== '80' && url.port !== '443') return { ok: false, code: 'URL_PORT_BLOCKED' };
  if (isBlockedHostname(url.hostname)) return { ok: false, code: 'URL_HOST_BLOCKED' };
  url.hash = '';
  return { ok: true, url };
}

async function readBounded(response, maxBytes, signal) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('HTML_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) {
        const error = new Error('read timeout');
        error.name = 'AbortError';
        throw error;
      }
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => {
          const error = new Error('read timeout');
          error.name = 'AbortError';
          reject(error);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      let next;
      try { next = await Promise.race([reader.read(), aborted]); }
      finally { signal?.removeEventListener('abort', onAbort); }
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error('HTML_TOO_LARGE');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel('bounded read stopped').catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(joined);
}

function publicUrlForOutput(url) {
  const safe = new URL(url.toString());
  safe.username = '';
  safe.password = '';
  safe.search = '';
  safe.hash = '';
  return safe.toString();
}

function safeCanonicalUrl(raw, pageUrl) {
  try {
    const candidate = new URL(decodeEntities(raw), pageUrl);
    if (!['http:', 'https:'].includes(candidate.protocol) || candidate.username || candidate.password ||
        isBlockedHostname(candidate.hostname)) return null;
    return publicUrlForOutput(candidate);
  } catch {
    return null;
  }
}

async function discardResponseBody(response) {
  try { await response.body?.cancel('response not needed'); } catch {}
}

export async function fetchPublicHtml(input, options = {}) {
  const validate = options.validateUrl || validatePublicPageUrl;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || FETCH_TIMEOUT_MS, 250), FETCH_TIMEOUT_MS);
  const maxBytes = Math.min(Math.max(Number(options.maxBytes) || MAX_HTML_BYTES, 1024), MAX_HTML_BYTES);
  let checked = validate(input);
  if (!checked.ok) return { ok: false, code: checked.code };
  let current = checked.url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('audit timeout'), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current.toString(), {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9', 'User-Agent': 'CEOAI-PublicAudit/0.1 (+https://ceoai.dev)' },
      });
    } catch (error) {
      clearTimeout(timer);
      return { ok: false, code: error?.name === 'AbortError' ? 'FETCH_TIMEOUT' : 'FETCH_FAILED' };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirects === MAX_REDIRECTS) { clearTimeout(timer); await discardResponseBody(response); return { ok: false, code: 'TOO_MANY_REDIRECTS' }; }
      const location = response.headers.get('location');
      if (!location) { clearTimeout(timer); await discardResponseBody(response); return { ok: false, code: 'REDIRECT_WITHOUT_LOCATION' }; }
      checked = validate(new URL(location, current).toString());
      if (!checked.ok) { clearTimeout(timer); await discardResponseBody(response); return { ok: false, code: 'REDIRECT_TARGET_BLOCKED', reason: checked.code }; }
      await discardResponseBody(response);
      current = checked.url;
      clearTimeout(timer);
      continue;
    }
    if (!response.ok) { clearTimeout(timer); await discardResponseBody(response); return { ok: false, code: 'HTTP_ERROR', status: response.status, finalUrl: publicUrlForOutput(current) }; }
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) {
      clearTimeout(timer);
      await discardResponseBody(response);
      return { ok: false, code: 'CONTENT_TYPE_NOT_HTML', contentType: type.slice(0, 100) };
    }
    try {
      const html = await readBounded(response, maxBytes, controller.signal);
      return { ok: true, status: response.status, finalUrl: publicUrlForOutput(current), contentType: type, html };
    } catch (error) {
      return { ok: false, code: error?.name === 'AbortError' ? 'FETCH_TIMEOUT' : error?.message === 'HTML_TOO_LARGE' ? 'HTML_TOO_LARGE' : 'BODY_READ_FAILED' };
    } finally { clearTimeout(timer); }
  }
  return { ok: false, code: 'TOO_MANY_REDIRECTS' };
}

function decodeEntities(value) {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }).replace(/&#x([\da-f]+);/gi, (_, n) => {
      const cp = parseInt(n, 16); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
}
function stripTags(value) { return decodeEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()); }
function firstMatch(html, regex) { const m = regex.exec(html); return m ? (m[1] ?? m[2] ?? '') : ''; }

/** Deterministic observations only; no AI-generated scores or inferred live metrics. */
export function extractHtmlObservations(html, pageUrl) {
  if (typeof html !== 'string') throw new TypeError('html must be a string');
  const title = stripTags(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)).slice(0, 500);
  const metaDescription = decodeEntities(firstMatch(html, /<meta\b(?=[^>]*\bname\s*=\s*["']description["'])[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<meta\b(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])(?=[^>]*\bname\s*=\s*["']description["'])[^>]*>/i)).slice(0, 1000);
  const canonicalRaw = firstMatch(html, /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i) ||
    firstMatch(html, /<link\b(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i);
  let canonical = null;
  if (canonicalRaw) canonical = safeCanonicalUrl(canonicalRaw, pageUrl);
  const robots = firstMatch(html, /<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<meta\b(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*>/i);
  const headings = {};
  for (let level = 1; level <= 6; level++) {
    const re = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}\\s*>`, 'gi');
    headings[`h${level}`] = [...html.matchAll(re)].slice(0, 100).map(m => stripTags(m[1]).slice(0, 300));
  }
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].slice(0, 1000).map(([tag]) => {
    const alt = firstMatch(tag, /\balt\s*=\s*["']([^"']*)["']/i);
    const src = firstMatch(tag, /\b(?:src|data-src)\s*=\s*["']([^"']*)["']/i);
    return { hasAlt: /\balt\s*=\s*["'][^"']*["']/i.test(tag), alt: decodeEntities(alt).slice(0, 300), hasSource: Boolean(src) };
  });
  const jsonLdBlocks = [...html.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)].slice(0, 100).map(m => {
    try { const parsed = JSON.parse(m[1]); return { validJson: true, type: Array.isArray(parsed) ? parsed.map(x => x?.['@type']).flat().filter(Boolean) : [parsed?.['@type']].flat().filter(Boolean) }; }
    catch { return { validJson: false, type: [] }; }
  });
  const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi)].slice(0, 2000).map(m => m[1]);
  let internalLinks = 0, externalLinks = 0, invalidLinks = 0;
  let origin = null; try { origin = new URL(pageUrl).origin; } catch {}
  for (const href of links) {
    try { const target = new URL(decodeEntities(href), pageUrl); if (!['http:', 'https:'].includes(target.protocol)) continue; if (origin && target.origin === origin) internalLinks++; else externalLinks++; }
    catch { invalidLinks++; }
  }
  return {
    schemaVersion: 'ceoai.audit.observations.v1', source: 'FETCHED_HTML', pageUrl: (() => { try { return publicUrlForOutput(new URL(pageUrl)); } catch { return null; } })(),
    title: { value: title || null, status: title ? 'MEASURED' : 'MISSING' },
    metaDescription: { value: metaDescription || null, status: metaDescription ? 'MEASURED' : 'MISSING' },
    canonical: { value: canonical, status: canonical ? 'MEASURED' : 'MISSING' },
    robotsMeta: { value: robots || null, status: robots ? 'MEASURED' : 'NOT_DECLARED_IN_HTML' },
    headings, images: { count: images.length, missingAlt: images.filter(i => !i.hasAlt || !i.alt.trim()).length, missingSource: images.filter(i => !i.hasSource).length },
    structuredData: { jsonLdBlocks: jsonLdBlocks.length, validJsonLdBlocks: jsonLdBlocks.filter(b => b.validJson).length, types: [...new Set(jsonLdBlocks.flatMap(b => b.type))] },
    links: { inspected: links.length, internal: internalLinks, external: externalLinks, invalid: invalidLinks },
    notMeasuredHere: ['Core Web Vitals', 'backlinks', 'live search rankings', 'actual AI citations', 'competitor traffic'],
  };
}
