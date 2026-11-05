// Per-task atomic checkpoint storage for CEOAI workflows.
// One Durable Object instance is selected per task ID. Writes use revision CAS.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_BYTES = 24_576;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export class WorkflowTaskDO {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    const path = new URL(request.url).pathname;
    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES + 1024) return json({ ok: false, code: "REQUEST_TOO_LARGE" }, 413);
      body = JSON.parse(raw);
    } catch { return json({ ok: false, code: "INVALID_JSON" }, 400); }
    if (!plain(body) || typeof body.id !== "string" || !TASK_ID.test(body.id) ||
        Object.keys(body).some(key => !["id", "state", "expectedRevision"].includes(key))) {
      return json({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    try {
      if (path === "/get") {
        if (Object.keys(body).length !== 1) return json({ ok: false, code: "INVALID_REQUEST" }, 400);
        const state = await this.ctx.storage.get("checkpoint");
        return state ? json({ ok: true, state }) : json({ ok: true, state: null });
      }
      if (path === "/put") {
        if (!plain(body.state) || body.state.id !== body.id ||
            !Number.isSafeInteger(body.state.revision) || body.state.revision < 0 ||
            !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < -1 ||
            body.state.revision !== body.expectedRevision + 1 ||
            new TextEncoder().encode(JSON.stringify(body.state)).byteLength > MAX_BYTES) {
          return json({ ok: false, code: "INVALID_CHECKPOINT" }, 400);
        }
        const result = await this.ctx.storage.transaction(async txn => {
          const current = await txn.get("checkpoint");
          const revision = current ? current.revision : -1;
          if (revision !== body.expectedRevision) return { ok: false, code: "CHECKPOINT_CONFLICT", revision };
          await txn.put("checkpoint", body.state);
          return { ok: true, revision: body.state.revision };
        });
        return json(result, result.ok ? 200 : 409);
      }
      if (path === "/delete") {
        if (Object.keys(body).length !== 2 || !Number.isSafeInteger(body.expectedRevision)) return json({ ok: false, code: "INVALID_REQUEST" }, 400);
        const result = await this.ctx.storage.transaction(async txn => {
          const current = await txn.get("checkpoint");
          if (!current || current.revision !== body.expectedRevision) return { ok: false, code: "CHECKPOINT_CONFLICT" };
          await txn.delete("checkpoint");
          return { ok: true };
        });
        return json(result, result.ok ? 200 : 409);
      }
      return json({ ok: false, code: "NOT_FOUND" }, 404);
    } catch { return json({ ok: false, code: "WORKFLOW_STORAGE_UNAVAILABLE" }, 503); }
  }
}
