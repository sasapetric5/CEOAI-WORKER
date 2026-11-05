// App-scoped persistent memory primitives for authenticated application gateways.
// The caller MUST pass appId from verified HMAC auth, never from request JSON.
// RankGeo is supported by the namespace contract but remains disabled by its app policy.
const APP_IDS = new Set(["CONTENTCRAFT-APP", "AIFORCE-APP", "RANKGEO-APP"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = "v1";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_VALUE_BYTES = 24_000;

function validSessionId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function memoryKey(appId, sessionId, kind) {
  return `app-memory:${VERSION}:${appId}:${sessionId}:${kind}`;
}

export function createAppMemoryStore({ kv, appId, appPolicy, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function" || typeof kv.delete !== "function") {
    throw new TypeError("APP_MEMORY_STORAGE_UNAVAILABLE");
  }
  if (!APP_IDS.has(appId)) throw new TypeError("APP_MEMORY_UNKNOWN_APP");
  if (!appPolicy || appPolicy.memory !== true) throw new TypeError("APP_MEMORY_NOT_CONFIGURED");
  if (appPolicy.enabled !== true) throw new Error("APP_DISABLED");
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > DEFAULT_TTL_SECONDS) {
    throw new TypeError("APP_MEMORY_INVALID_TTL");
  }

  // This store instance is permanently bound to one authenticated app identity.
  const prefix = `app-memory:${VERSION}:${appId}:`;
  const keyFor = (sessionId, kind) => {
    if (!validSessionId(sessionId)) throw new TypeError("APP_MEMORY_INVALID_SESSION");
    return memoryKey(appId, sessionId, kind);
  };

  return Object.freeze({
    appId,
    async read(sessionId) {
      const [historyRaw, summary] = await Promise.all([
        kv.get(keyFor(sessionId, "history")),
        kv.get(keyFor(sessionId, "summary")),
      ]);
      let history = [];
      if (historyRaw) {
        try {
          const parsed = JSON.parse(historyRaw);
          if (Array.isArray(parsed)) history = parsed.filter(item =>
            item && (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string"
          ).slice(-16).map(item => ({ role: item.role, content: item.content.slice(0, 8000) }));
        } catch { history = []; }
      }
      return { history, summary: typeof summary === "string" ? summary.slice(0, 4000) : "" };
    },
    async write(sessionId, { history = [], summary = "" } = {}) {
      if (!Array.isArray(history) || typeof summary !== "string") throw new TypeError("APP_MEMORY_INVALID_VALUE");
      const safeHistory = history.filter(item =>
        item && (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string"
      ).slice(-16).map(item => ({ role: item.role, content: item.content.slice(0, 8000) }));
      const historyValue = JSON.stringify(safeHistory);
      const safeSummary = summary.slice(0, 4000);
      if (new TextEncoder().encode(historyValue).byteLength + new TextEncoder().encode(safeSummary).byteLength > MAX_VALUE_BYTES) {
        throw new RangeError("APP_MEMORY_VALUE_TOO_LARGE");
      }
      await Promise.all([
        kv.put(keyFor(sessionId, "history"), historyValue, { expirationTtl: ttlSeconds }),
        kv.put(keyFor(sessionId, "summary"), safeSummary, { expirationTtl: ttlSeconds }),
      ]);
      return { success: true };
    },
    async reset(sessionId) {
      await Promise.all([
        kv.delete(keyFor(sessionId, "history")),
        kv.delete(keyFor(sessionId, "summary")),
      ]);
      return { success: true };
    },
    // Exposed for diagnostics/tests only; never accepts an arbitrary appId.
    namespacePrefix: prefix,
  });
}
