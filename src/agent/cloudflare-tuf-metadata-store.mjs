// Atomic adapter for the Sigstore TUF metadata cache in the existing SecurityOrchestratorDO.
// This stores only verifier-produced metadata bytes; it does not make cached bytes trusted.
// The TUF engine must re-verify every cached object against the pinned bootstrap root.
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const ALLOWED_NAME = /^(?:root|timestamp|(?:[0-9]+\.)?(?:snapshot|targets))\.json$/;

function validateSnapshot(value) {
  if (!value || value.ok !== true || !Number.isSafeInteger(value.revision) ||
      value.revision < 0 || !Number.isSafeInteger(value.rootVersion) || value.rootVersion < 0 ||
      !value.cache || typeof value.cache !== "object" || Array.isArray(value.cache)) {
    throw new Error("TUF_CACHE_INVALID_RESPONSE");
  }
  return value;
}

function validateCache(cache) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) throw new TypeError("INVALID_TUF_CACHE");
  const entries = Object.entries(cache);
  if (!entries.length || entries.length > 128 || !Object.hasOwn(cache, "root.json")) throw new TypeError("INVALID_TUF_CACHE");
  let total = 0;
  for (const [name, encoded] of entries) {
    if (!ALLOWED_NAME.test(name) || typeof encoded !== "string" ||
        encoded.length < 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new TypeError("INVALID_TUF_CACHE_ENTRY");
    }
    total += encoded.length;
    if (total > MAX_CACHE_BYTES) throw new TypeError("TUF_CACHE_TOO_LARGE");
  }
  return cache;
}

export function createCloudflareTufMetadataStore(namespace) {
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new TypeError("SECURITY_DO_BINDING_REQUIRED");
  }
  const stub = namespace.get(namespace.idFromName("sigstore-tuf-global"));
  async function request(path, payload = {}) {
    const response = await stub.fetch("https://security-do.internal" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error("TUF_CACHE_INVALID_RESPONSE"); }
    if (!response.ok) {
      const error = new Error(result?.code || "TUF_CACHE_UNAVAILABLE");
      error.code = result?.code || "TUF_CACHE_UNAVAILABLE";
      error.status = response.status;
      throw error;
    }
    return result;
  }
  return Object.freeze({
    async load() {
      return validateSnapshot(await request("/tuf/cache/read"));
    },
    async commit({ expectedRevision, rootVersion, cache }) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
          !Number.isSafeInteger(rootVersion) || rootVersion < 1) throw new TypeError("INVALID_TUF_CACHE_COMMIT");
      validateCache(cache);
      const result = await request("/tuf/cache/commit", { expectedRevision, rootVersion, cache });
      if (result?.ok !== true || !Number.isSafeInteger(result.revision) ||
          result.revision !== expectedRevision + 1 || result.rootVersion !== rootVersion) {
        const error = new Error(result?.code || "TUF_CACHE_COMMIT_FAILED");
        error.code = result?.code || "TUF_CACHE_COMMIT_FAILED";
        throw error;
      }
      return result;
    },
  });
}
