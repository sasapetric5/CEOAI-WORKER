// Cloudflare Durable Object adapter for the CEOAI checkpoint engine.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function createCloudflareCheckpointStore(namespace) {
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new TypeError("WORKFLOW_TASK_BINDING_REQUIRED");
  }
  async function request(id, path, payload = {}) {
    if (typeof id !== "string" || !TASK_ID.test(id)) throw new TypeError("INVALID_TASK_ID");
    const stub = namespace.get(namespace.idFromName(id));
    const response = await stub.fetch("https://workflow-task.internal" + path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error("WORKFLOW_STORAGE_INVALID_RESPONSE"); }
    if (!response.ok || result?.ok !== true) {
      const error = new Error(result?.code || "WORKFLOW_STORAGE_UNAVAILABLE");
      error.code = result?.code || "WORKFLOW_STORAGE_UNAVAILABLE";
      throw error;
    }
    return result;
  }
  async function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + (await Promise.all(value.map(canonical))).join(",") + "]";
    const keys = Object.keys(value).sort();
    return "{" + (await Promise.all(keys.map(async key => JSON.stringify(key) + ":" + await canonical(value[key])))).join(",") + "}";
  }
  async function digest(value) {
    let serialized;
    try { serialized = JSON.stringify(value); } catch { throw new TypeError("INVALID_EFFECT_PAYLOAD"); }
    if (typeof serialized !== "string") throw new TypeError("INVALID_EFFECT_PAYLOAD");
    const normalized = JSON.parse(serialized);
    const encoded = new TextEncoder().encode(await canonical(normalized));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
    return [...hash].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return Object.freeze({
    async acquireLease(id, ownerToken, leaseMs = 30_000) {
      return (await request(id, "/lease/acquire", { ownerToken, leaseMs })).lease;
    },
    async renewLease(id, ownerToken, fencingToken, leaseMs = 30_000) {
      return (await request(id, "/lease/renew", { ownerToken, fencingToken, leaseMs })).lease;
    },
    async releaseLease(id, ownerToken, fencingToken) {
      await request(id, "/lease/release", { ownerToken, fencingToken });
      return true;
    },
    async claimEffect(id, ownerToken, fencingToken, effectKey, payload) {
      const payloadHash = await digest(payload);
      const result = await request(id, "/effect/claim", { ownerToken, fencingToken, effectKey, payloadHash });
      return result.replay ? { replay: true, result: result.effect.result } : { replay: false, payloadHash };
    },
    async completeEffect(id, ownerToken, fencingToken, effectKey, payloadHash, result) {
      return (await request(id, "/effect/complete", { ownerToken, fencingToken, effectKey, payloadHash, result })).effect;
    },
    async getEffect(id, ownerToken, fencingToken, effectKey) {
      return (await request(id, "/effect/get", { ownerToken, fencingToken, effectKey })).effect;
    },
    async get(id) { return (await request(id, "/get")).state; },
    async put(id, state, lease) {
      if (!lease || typeof lease.ownerToken !== "string" || !Number.isSafeInteger(lease.fencingToken)) {
        throw new TypeError("ACTIVE_WORKFLOW_LEASE_REQUIRED");
      }
      await request(id, "/put", {
        state, expectedRevision: state.revision - 1,
        ownerToken: lease.ownerToken, fencingToken: lease.fencingToken,
      });
      return true;
    },
    async delete(id, expectedRevision) {
      await request(id, "/delete", { expectedRevision });
      return true;
    },
  });
}
