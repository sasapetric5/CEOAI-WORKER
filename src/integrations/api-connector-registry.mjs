// CEOAI read-only API connectors. Destinations and operations are code-owned.
// No arbitrary URL, credentials, cookies, user headers, request bodies or writes.
const ORIGIN = "https://hn.algolia.com";
const OPERATIONS = Object.freeze({
  search: "/api/v1/search",
  search_by_date: "/api/v1/search_by_date",
});
const TAGS = new Set(["story", "comment", "poll", "pollopt", "show_hn", "ask_hn", "front_page"]);
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_ITEMS = 10;
const isPlain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function validateArgs(operationId, args) {
  if (!isPlain(args)) return { ok: false, code: "CONNECTOR_INVALID_ARGUMENTS" };
  const allowed = new Set(["query", "tags", "page", "hitsPerPage"]);
  const keys = Reflect.ownKeys(args);
  if (keys.some(key => typeof key !== "string" || !allowed.has(key))) return { ok: false, code: "CONNECTOR_UNKNOWN_ARGUMENT" };
  const safeArgs = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return { ok: false, code: "CONNECTOR_INVALID_ARGUMENTS" };
    safeArgs[key] = descriptor.value;
  }
  args = safeArgs;
  if (operationId === "search" && (typeof args.query !== "string" || !args.query.trim() || args.query.length > 120)) {
    return { ok: false, code: Object.hasOwn(args, "query") ? "CONNECTOR_INVALID_ARGUMENT" : "CONNECTOR_MISSING_ARGUMENT" };
  }
  if (operationId === "search_by_date" && args.query !== undefined &&
      (typeof args.query !== "string" || !args.query.trim() || args.query.length > 120)) return { ok: false, code: "CONNECTOR_INVALID_ARGUMENT" };
  if (args.tags !== undefined && (typeof args.tags !== "string" || !TAGS.has(args.tags))) return { ok: false, code: "CONNECTOR_INVALID_ARGUMENT" };
  if (args.page !== undefined && (!Number.isSafeInteger(args.page) || args.page < 0 || args.page > 3)) return { ok: false, code: "CONNECTOR_INVALID_ARGUMENT" };
  if (args.hitsPerPage !== undefined && (!Number.isSafeInteger(args.hitsPerPage) || args.hitsPerPage < 1 || args.hitsPerPage > 20)) return { ok: false, code: "CONNECTOR_INVALID_ARGUMENT" };
  const params = new URLSearchParams();
  for (const key of ["query", "tags", "page", "hitsPerPage"]) if (args[key] !== undefined) params.set(key, String(args[key]).trim());
  return { ok: true, params };
}

async function readJsonLimited(response, limit) {
  const length = Number(response.headers?.get?.("Content-Length"));
  if (Number.isFinite(length) && length > limit) return null;
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) return null;
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
      if (total > limit) { try { await reader.cancel(); } catch {} return null; }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch {} }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
}

function cleanRecord(hit) {
  if (!isPlain(hit)) return null;
  const fields = {
    id: hit.objectID, title: hit.title, url: hit.url, author: hit.author,
    points: hit.points, comments: hit.num_comments, createdAt: hit.created_at, storyText: hit.story_text,
  };
  const clean = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1000);
      if (text) clean[key] = text;
    } else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
  }
  return Object.keys(clean).length ? clean : null;
}

export function createAPIConnectorRegistry({ fetchImpl = globalThis.fetch, timeoutMs = 8000, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("CONNECTOR_FETCH_REQUIRED");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30000) throw new TypeError("INVALID_CONNECTOR_TIMEOUT");
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > MAX_RESPONSE_BYTES) throw new TypeError("INVALID_CONNECTOR_RESPONSE_LIMIT");
  const connector = Object.freeze({
    id: "hacker_news_algolia", version: "1.0.0", name: "Hacker News Search",
    origin: ORIGIN, authentication: "none", access: "public-read-only",
    operations: Object.freeze(Object.keys(OPERATIONS).map(id => Object.freeze({ id, method: "GET", path: OPERATIONS[id] }))),
  });
  return Object.freeze({
    list() { return [{ ...connector, operations: connector.operations.map(item => ({ ...item })) }]; },
    get(id) { return id === connector.id ? { ...connector, operations: connector.operations.map(item => ({ ...item })) } : null; },
    async execute(connectorId, operationId, args = {}) {
      if (connectorId !== connector.id) return { ok: false, code: "CONNECTOR_NOT_FOUND" };
      const path = OPERATIONS[operationId];
      if (!path) return { ok: false, code: "CONNECTOR_OPERATION_NOT_FOUND" };
      const checked = validateArgs(operationId, args);
      if (!checked.ok) return checked;
      const url = new URL(path, ORIGIN);
      url.search = checked.params.toString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), {
          method: "GET", headers: { Accept: "application/json" },
          redirect: "error", cache: "no-store", signal: controller.signal,
        });
        if (response.status === 429) {
          const raw = Number(response.headers?.get?.("Retry-After"));
          return { ok: false, code: "CONNECTOR_RATE_LIMITED", retryAfterSeconds: Number.isFinite(raw) && raw > 0 ? Math.min(3600, Math.ceil(raw)) : 60 };
        }
        if (!response.ok) return { ok: false, code: response.status === 404 ? "CONNECTOR_ENDPOINT_NOT_FOUND" : "CONNECTOR_HTTP_ERROR" };
        if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(response.headers?.get?.("Content-Type") || "")) return { ok: false, code: "CONNECTOR_CONTENT_TYPE_REJECTED" };
        const data = await readJsonLimited(response, maxResponseBytes);
        if (!isPlain(data) || !Array.isArray(data.hits)) return { ok: false, code: "CONNECTOR_INVALID_RESPONSE" };
        const records = [];
        for (const hit of data.hits.slice(0, MAX_ITEMS)) {
          const record = cleanRecord(hit);
          if (!record) continue;
          if (new TextEncoder().encode(JSON.stringify([...records, record])).byteLength > MAX_OUTPUT_BYTES) break;
          records.push(record);
        }
        return {
          ok: true, connectorId, operationId, count: records.length, records,
          meta: {
            totalHits: Number.isSafeInteger(data.nbHits) && data.nbHits >= 0 ? data.nbHits : null,
            page: Number.isSafeInteger(data.page) && data.page >= 0 ? data.page : null,
          },
        };
      } catch (error) {
        return { ok: false, code: error?.name === "AbortError" ? "CONNECTOR_TIMEOUT" : "CONNECTOR_NETWORK_ERROR" };
      } finally { clearTimeout(timer); }
    },
  });
}
