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
    async get(id) { return (await request(id, "/get")).state; },
    async put(id, state) {
      await request(id, "/put", { state, expectedRevision: state.revision - 1 });
      return true;
    },
    async delete(id, expectedRevision) {
      await request(id, "/delete", { expectedRevision });
      return true;
    },
  });
}
