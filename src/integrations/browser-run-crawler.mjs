// Cloudflare Browser Run /crawl adapter. It submits bounded, non-rendered site crawls.
// No arbitrary outbound fetches are performed by CEOAI itself.
const API_ROOT = "https://api.cloudflare.com/client/v4/accounts/";
const MAX_PAGES_PER_JOB = 20; // Conservative internal cap; Workers Free allows up to 100.
const MAX_DEPTH = 2;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_RECORD_CHARS = 20_000;
const TERMINAL_STATUSES = new Set([
  "completed", "cancelled_due_to_timeout", "cancelled_due_to_limits",
  "cancelled_by_user", "errored",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\\.$/, "");
  if (!host || host.length > 253) return false;
  if (host.includes(":") || /^\\d+(?:\\.\\d+){0,3}$/.test(host) ||
      /^(?:0x[0-9a-f]+|\\d+)(?:\\.(?:0x[0-9a-f]+|\\d+)){0,3}$/i.test(host)) return false;
  if (host === "localhost" || host === "metadata.google.internal" ||
      /\\.(?:localhost|local|lan|home|internal|test|invalid|onion|arpa)$/.test(host)) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every(label =>
    label.length > 0 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

export function normalizeBrowserRunUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !safeHost(url.hostname)) return null;
    url.hash = "";
    // Avoid forwarding common credential-like query parameters to the crawler or logs.
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|key|auth|session|password|secret|signature|sig|cookie)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeJobId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

function retryAfter(response) {
  const raw = response?.headers?.get?.("Retry-After");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(3600, Math.ceil(parsed)) : 60;
}

async function readJsonLimited(response) {
  const declared = Number(response.headers?.get?.("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel("response_limit"); } catch {}
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function mapHttpFailure(status, response) {
  if (status === 401 || status === 403) return { ok: false, code: "CRAWL_AUTH_FAILED" };
  if (status === 404) return { ok: false, code: "CRAWL_JOB_NOT_FOUND" };
  if (status === 408 || status === 504) return { ok: false, code: "CRAWL_TIMEOUT" };
  if (status === 429) return { ok: false, code: "CRAWL_RATE_LIMITED", retryAfterSeconds: retryAfter(response) };
  if (status >= 400 && status < 500) return { ok: false, code: "CRAWL_REQUEST_REJECTED" };
  return { ok: false, code: "CRAWL_PROVIDER_UNAVAILABLE" };
}

function normalizeStatusResult(data) {
  const result = data?.result;
  if (!isPlainObject(result) || typeof result.id !== "string" || !safeJobId(result.id) ||
      typeof result.status !== "string") return null;
  return {
    jobId: result.id,
    status: result.status,
    total: Number.isSafeInteger(result.total) && result.total >= 0 ? result.total : null,
    finished: Number.isSafeInteger(result.finished) && result.finished >= 0 ? result.finished : null,
    browserSecondsUsed: Number.isFinite(result.browserSecondsUsed) && result.browserSecondsUsed >= 0
      ? result.browserSecondsUsed : null,
  };
}

function normalizeRecord(record) {
  if (!isPlainObject(record)) return null;
  const url = normalizeBrowserRunUrl(record.url);
  if (!url || record.status !== "completed" || record.outcome === "error" ||
      typeof record.markdown !== "string" || !record.markdown.trim()) return null;
  const metadata = isPlainObject(record.metadata) ? record.metadata : {};
  return {
    url,
    title: typeof metadata.title === "string" ? metadata.title.slice(0, 300) : null,
    markdown: record.markdown.replace(/\\u0000/g, "").slice(0, MAX_RECORD_CHARS),
    httpStatus: Number.isInteger(metadata.status) && metadata.status >= 100 && metadata.status <= 599
      ? metadata.status : null,
  };
}

export function createBrowserRunCrawler({
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new TypeError("BROWSER_RUN_ACCOUNT_ID_REQUIRED");
  }
  if (typeof apiToken !== "string" || !apiToken.trim() || apiToken.length > 4096) {
    throw new TypeError("BROWSER_RUN_TOKEN_REQUIRED");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("BROWSER_RUN_FETCH_REQUIRED");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new TypeError("INVALID_BROWSER_RUN_TIMEOUT");
  }

  const endpoint = API_ROOT + accountId + "/browser-run/crawl";

  async function request(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint + path, {
        method,
        headers: {
          "Authorization": "Bearer " + apiToken,
          "Accept": "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) return mapHttpFailure(response.status, response);
      const data = await readJsonLimited(response);
      if (!isPlainObject(data) || data.success !== true) {
        return { ok: false, code: "CRAWL_INVALID_RESPONSE" };
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, code: error?.name === "AbortError" ? "CRAWL_TIMEOUT" : "CRAWL_PROVIDER_UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function startCrawl({ url, pageLimit = 10, depth = 1 } = {}) {
    const safeUrl = normalizeBrowserRunUrl(url);
    if (!safeUrl) return { ok: false, code: "CRAWL_URL_REJECTED" };
    if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_PAGES_PER_JOB) {
      return { ok: false, code: "CRAWL_PAGE_LIMIT_REJECTED" };
    }
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
      return { ok: false, code: "CRAWL_DEPTH_REJECTED" };
    }
    const origin = new URL(safeUrl).origin;
    const response = await request("", {
      method: "POST",
      body: {
        url: safeUrl,
        limit: pageLimit,
        depth,
        formats: ["markdown"],
        render: false,
        crawlPurposes: ["search", "ai-input"],
        contentUse: "reference",
        source: "all",
        options: {
          includeExternalLinks: false,
          includeSubdomains: false,
          includePatterns: [origin + "/**"],
        },
      },
    });
    if (!response.ok) return response;
    const jobId = typeof response.data.result === "string"
      ? response.data.result
      : response.data.result?.id;
    if (!safeJobId(jobId)) return { ok: false, code: "CRAWL_INVALID_RESPONSE" };
    return { ok: true, jobId, sourceUrl: safeUrl, pageLimit, depth, render: false };
  }

  async function getStatus(jobId) {
    if (!safeJobId(jobId)) return { ok: false, code: "CRAWL_INVALID_JOB_ID" };
    const response = await request("/" + encodeURIComponent(jobId) + "?limit=1");
    if (!response.ok) return response;
    const result = normalizeStatusResult(response.data);
    return result ? { ok: true, ...result, terminal: TERMINAL_STATUSES.has(result.status) }
      : { ok: false, code: "CRAWL_INVALID_RESPONSE" };
  }

  async function getResults(jobId, { limit = 10 } = {}) {
    if (!safeJobId(jobId)) return { ok: false, code: "CRAWL_INVALID_JOB_ID" };
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGES_PER_JOB) {
      return { ok: false, code: "CRAWL_PAGE_LIMIT_REJECTED" };
    }
    const response = await request("/" + encodeURIComponent(jobId) + "?limit=" + limit + "&status=completed");
    if (!response.ok) return response;
    const status = normalizeStatusResult(response.data);
    if (!status) return { ok: false, code: "CRAWL_INVALID_RESPONSE" };
    if (status.status !== "completed") return { ok: true, ...status, records: [] };
    const records = Array.isArray(response.data.result.records)
      ? response.data.result.records.slice(0, limit).map(normalizeRecord).filter(Boolean)
      : [];
    return { ok: true, ...status, records };
  }

  return Object.freeze({ startCrawl, getStatus, getResults });
}
