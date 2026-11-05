// Per-task atomic checkpoint storage for CEOAI workflows.
// One Durable Object instance is selected per task ID. Writes use revision CAS.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_BYTES = 24_576;
const MAX_EFFECTS_PER_TASK = 128;
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 60_000;
const OWNER_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
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
        Object.keys(body).some(key => !["id", "state", "expectedRevision", "ownerToken", "fencingToken", "leaseMs", "effectKey", "payloadHash", "result"].includes(key))) {
      return json({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    try {
      if (path === "/lease/acquire") {
        if (Object.keys(body).some(key => !["id", "ownerToken", "leaseMs"].includes(key)) ||
            Object.keys(body).length !== 3 || typeof body.ownerToken !== "string" || !OWNER_TOKEN.test(body.ownerToken) ||
            !Number.isSafeInteger(body.leaseMs) || body.leaseMs < MIN_LEASE_MS || body.leaseMs > MAX_LEASE_MS) {
          return json({ ok: false, code: "INVALID_LEASE_REQUEST" }, 400);
        }
        const now = Date.now();
        const result = await this.ctx.storage.transaction(async txn => {
          const current = await txn.get("lease");
          if (current && current.expiresAt > now) return { ok: false, code: "TASK_LEASE_HELD", expiresAt: current.expiresAt };
          const previous = await txn.get("fencingToken") || 0;
          if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) {
            return { ok: false, code: "FENCING_TOKEN_EXHAUSTED" };
          }
          const fencingToken = previous + 1;
          const lease = { ownerToken: body.ownerToken, fencingToken, acquiredAt: now, expiresAt: now + body.leaseMs };
          await txn.put("fencingToken", fencingToken);
          await txn.put("lease", lease);
          return { ok: true, lease };
        });
        return json(result, result.ok ? 200 : result.code === "TASK_LEASE_HELD" ? 409 : 503);
      }
      if (path === "/lease/renew") {
        if (Object.keys(body).some(key => !["id", "ownerToken", "fencingToken", "leaseMs"].includes(key)) ||
            Object.keys(body).length !== 4 || typeof body.ownerToken !== "string" || !OWNER_TOKEN.test(body.ownerToken) ||
            !Number.isSafeInteger(body.fencingToken) || body.fencingToken < 1 ||
            !Number.isSafeInteger(body.leaseMs) || body.leaseMs < MIN_LEASE_MS || body.leaseMs > MAX_LEASE_MS) {
          return json({ ok: false, code: "INVALID_LEASE_REQUEST" }, 400);
        }
        const now = Date.now();
        const result = await this.ctx.storage.transaction(async txn => {
          const current = await txn.get("lease");
          if (!current || current.expiresAt <= now || current.ownerToken !== body.ownerToken ||
              current.fencingToken !== body.fencingToken) return { ok: false, code: "LEASE_NOT_OWNED" };
          const lease = { ...current, expiresAt: now + body.leaseMs };
          await txn.put("lease", lease);
          return { ok: true, lease };
        });
        return json(result, result.ok ? 200 : 409);
      }
      if (path === "/lease/release") {
        if (Object.keys(body).some(key => !["id", "ownerToken", "fencingToken"].includes(key)) ||
            Object.keys(body).length !== 3 || typeof body.ownerToken !== "string" || !OWNER_TOKEN.test(body.ownerToken) ||
            !Number.isSafeInteger(body.fencingToken) || body.fencingToken < 1) {
          return json({ ok: false, code: "INVALID_LEASE_REQUEST" }, 400);
        }
        const result = await this.ctx.storage.transaction(async txn => {
          const current = await txn.get("lease");
          if (!current || current.ownerToken !== body.ownerToken || current.fencingToken !== body.fencingToken) {
            return { ok: false, code: "LEASE_NOT_OWNED" };
          }
          await txn.delete("lease");
          return { ok: true };
        });
        return json(result, result.ok ? 200 : 409);
      }
      if (path === "/get") {
        if (Object.keys(body).length !== 1) return json({ ok: false, code: "INVALID_REQUEST" }, 400);
        const state = await this.ctx.storage.get("checkpoint");
        return state ? json({ ok: true, state }) : json({ ok: true, state: null });
      }
      if (path === "/put") {
        if (Object.keys(body).length !== 5 || !Object.hasOwn(body, "state") || !Object.hasOwn(body, "expectedRevision") ||
            !plain(body.state) || body.state.id !== body.id ||
            !Number.isSafeInteger(body.state.revision) || body.state.revision < 0 ||
            !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < -1 ||
            body.state.revision !== body.expectedRevision + 1 ||
            typeof body.ownerToken !== "string" || !OWNER_TOKEN.test(body.ownerToken) ||
            !Number.isSafeInteger(body.fencingToken) || body.fencingToken < 1 ||
            new TextEncoder().encode(JSON.stringify(body.state)).byteLength > MAX_BYTES) {
          return json({ ok: false, code: "INVALID_CHECKPOINT" }, 400);
        }
        const now = Date.now();
        const result = await this.ctx.storage.transaction(async txn => {
          const lease = await txn.get("lease");
          if (!lease || lease.expiresAt <= now || lease.ownerToken !== body.ownerToken ||
              lease.fencingToken !== body.fencingToken) return { ok: false, code: "STALE_EXECUTOR" };
          const current = await txn.get("checkpoint");
          const revision = current ? current.revision : -1;
          if (revision !== body.expectedRevision) return { ok: false, code: "CHECKPOINT_CONFLICT", revision };
          await txn.put("checkpoint", body.state);
          return { ok: true, revision: body.state.revision, fencingToken: lease.fencingToken };
        });
        return json(result, result.ok ? 200 : 409);
      }
      if (path === "/effect/claim") {
        if (Object.keys(body).length !== 5 || typeof body.ownerToken !== "string" || !OWNER_TOKEN.test(body.ownerToken) ||
            !Number.isSafeInteger(body.fencingToken) || body.fencingToken < 1 ||
            typeof body.effectKey !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(body.effectKey) ||
            typeof body.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(body.payloadHash)) {
          return json({ ok: false, code: "INVALID_EFFECT_REQUEST" }, 400);
        }
        const now = Date.now();
        const result = await this.ctx.storage.transaction(async txn => {
          const lease = await txn.get("lease");
          if (!lease || lease.expiresAt <= now || lease.ownerToken !== body.ownerToken ||
              lease.fencingToken !== body.fencingToken) return { ok: false, code: "STALE_EXECUTOR" };
          const key = "effect:" + body.effectKey;
          const current = await txn.get(key);
          if (current) {
            if (current.payloadHash !== body.payloadHash) return { ok: false, code: "IDEMPOTENCY_KEY_CONFLICT" };
            if (current.status === "completed") return { ok: true, replay: true, effect: current };
            return { ok: false, code: "EFFECT_OUTCOME_UNKNOWN", effect: current };
          }
          const count = await txn.get("effectCount") || 0;
          if (!Number.isSafeInteger(count) || count < 0 || count >= MAX_EFFECTS_PER_TASK) {
            return { ok: false, code: "EFFECT_LEDGER_LIMIT" };
          }
          const effect = { status: "started", payloadHash: body.payloadHash, fencingToken: lease.fencingToken, startedAt: now };
          await txn.put(key, effect);
          await txn.put("effectCount", count + 1);
          return { ok: true, replay: false, effect };
        });
        return json(result, result.ok ? 200 : result.code === "STALE_EXECUTOR" ? 409 : 409);
      }
      if (path === "/effect/get") {
        if (Object.keys(body).length !== 4 || typeof body.ownerToken !== "string" || !OWNER_TOKEN.test(body.ownerToken) ||
            !Number.isSafeInteger(body.fencingToken) || body.fencingToken < 1 ||
            typeof body.effectKey !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(body.effectKey)) {
          return json({ ok: false, code: "INVALID_EFFECT_REQUEST" }, 400);
        }
        const now = Date.now();
        const result = await this.ctx.storage.transaction(async txn => {
          const lease = await txn.get("lease");
          if (!lease || lease.expiresAt <= now || lease.ownerToken !== body.ownerToken ||
              lease.fencingToken !== body.fencingToken) return { ok: false, code: "STALE_EXECUTOR" };
          return { ok: true, effect: await txn.get("effect:" + body.effectKey) || null };
        });
        return json(result, result.ok ? 200 : 409);
      }
      if (path === "/effect/complete") {
        if (Object.keys(body).length !== 6 || typeof body.ownerToken !== "string" || !OWNER_TOKEN.test(body.ownerToken) ||
            !Number.isSafeInteger(body.fencingToken) || body.fencingToken < 1 ||
            typeof body.effectKey !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(body.effectKey) ||
            typeof body.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(body.payloadHash) ||
            !Object.hasOwn(body, "result") || new TextEncoder().encode(JSON.stringify(body.result)).byteLength > MAX_BYTES) {
          return json({ ok: false, code: "INVALID_EFFECT_REQUEST" }, 400);
        }
        const now = Date.now();
        const result = await this.ctx.storage.transaction(async txn => {
          const lease = await txn.get("lease");
          if (!lease || lease.expiresAt <= now || lease.ownerToken !== body.ownerToken ||
              lease.fencingToken !== body.fencingToken) return { ok: false, code: "STALE_EXECUTOR" };
          const key = "effect:" + body.effectKey;
          const current = await txn.get(key);
          if (!current || current.status !== "started" || current.payloadHash !== body.payloadHash ||
              current.fencingToken !== body.fencingToken) return { ok: false, code: "EFFECT_CLAIM_NOT_OWNED" };
          const effect = { ...current, status: "completed", result: body.result, completedAt: now };
          await txn.put(key, effect);
          return { ok: true, effect };
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
