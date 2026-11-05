// CEOAI Durable Execution Engine v1.1
// Lease-fenced checkpointing and durable idempotency for resumable Worker tasks.
// External executors MUST forward idempotencyKey to downstream systems that support it.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const STEP_ID = /^[a-z][a-z0-9_-]{0,47}$/;
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const OWNER_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 60_000;
const MAX_STATE_BYTES = 24_576;
const MAX_STEPS = 64;
const TERMINAL = new Set(["failed", "completed", "cancelled"]);
const PAUSED = new Set(["paused_approval", "paused_reconciliation"]);
const STATUSES = new Set(["ready", "running", "paused_approval", "paused_reconciliation", "failed", "completed", "cancelled"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const error = code => ({ ok: false, code });
const errorCode = (cause, fallback) => typeof cause?.code === "string" ? cause.code : fallback;
const clone = value => JSON.parse(JSON.stringify(value));

function snapshot(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object" || depth > 16 || seen.has(value)) return undefined;
  const array = Array.isArray(value);
  if (!array && !plain(value)) return undefined;
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string" || (array && key !== "length" && !/^(0|[1-9]\\d*)$/.test(key)))) return undefined;
  const out = array ? [] : Object.create(null);
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return undefined;
    const child = snapshot(descriptor.value, seen, depth + 1);
    if (child === undefined) return undefined;
    if (array) out[Number(key)] = child;
    else out[key] = child;
  }
  seen.delete(value);
  if (array && out.length !== value.length) return undefined;
  return out;
}
function bounded(value) {
  const safe = snapshot(value);
  if (safe === undefined) return null;
  const json = JSON.stringify(safe);
  if (typeof json !== "string" || new TextEncoder().encode(json).byteLength > MAX_STATE_BYTES) return null;
  return JSON.parse(json);
}
function validPlan(steps) {
  return Array.isArray(steps) && steps.length > 0 && steps.length <= MAX_STEPS &&
    steps.every((step, index) => plain(step) && Object.keys(step).every(k => ["id", "kind", "input", "requiresApproval"].includes(k)) &&
      typeof step.id === "string" && STEP_ID.test(step.id) &&
      (step.kind === "task" || step.kind === "approval") &&
      (step.input === undefined || bounded(step.input) !== null) &&
      (step.requiresApproval === undefined || typeof step.requiresApproval === "boolean") &&
      (index === 0 || steps.slice(0, index).every(previous => previous.id !== step.id)));
}
function validLeaseMs(value) {
  return Number.isSafeInteger(value) && value >= MIN_LEASE_MS && value <= MAX_LEASE_MS;
}
function randomOwnerToken() {
  if (!globalThis.crypto?.getRandomValues) throw new Error("CRYPTO_RANDOM_REQUIRED");
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}
async function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + (await Promise.all(value.map(canonical))).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + (await Promise.all(keys.map(async key => JSON.stringify(key) + ":" + await canonical(value[key])))).join(",") + "}";
}
async function payloadDigest(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw new TypeError("INVALID_EFFECT_PAYLOAD"); }
  if (typeof serialized !== "string") throw new TypeError("INVALID_EFFECT_PAYLOAD");
  const safe = JSON.parse(serialized);
  const bytes = new TextEncoder().encode(await canonical(safe));
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map(value => value.toString(16).padStart(2, "0")).join("");
}

export function createMemoryCheckpointStore({ now = () => Date.now() } = {}) {
  const records = new Map();
  const leases = new Map();
  const fencing = new Map();
  const effects = new Map();
  function assertLease(id, ownerToken, fencingToken) {
    const lease = leases.get(id);
    if (!lease || lease.expiresAt <= now() || lease.ownerToken !== ownerToken || lease.fencingToken !== fencingToken) {
      const cause = new Error("STALE_EXECUTOR"); cause.code = "STALE_EXECUTOR"; throw cause;
    }
    return lease;
  }
  return Object.freeze({
    async get(id) { const value = records.get(id); return value ? clone(value) : null; },
    async put(id, value, lease) {
      if (!lease) throw new TypeError("ACTIVE_WORKFLOW_LEASE_REQUIRED");
      assertLease(id, lease.ownerToken, lease.fencingToken);
      const current = records.get(id);
      const expected = current ? current.revision : -1;
      if (value.revision !== expected + 1) {
        const cause = new Error("CHECKPOINT_CONFLICT"); cause.code = "CHECKPOINT_CONFLICT"; throw cause;
      }
      records.set(id, clone(value)); return true;
    },
    async delete(id, expectedRevision, lease) {
      if (!lease) throw new TypeError("ACTIVE_WORKFLOW_LEASE_REQUIRED");
      assertLease(id, lease.ownerToken, lease.fencingToken);
      const current = records.get(id);
      if (!current || current.revision !== expectedRevision) {
        const cause = new Error("CHECKPOINT_CONFLICT"); cause.code = "CHECKPOINT_CONFLICT"; throw cause;
      }
      return records.delete(id);
    },
    async acquireLease(id, ownerToken, leaseMs = 30_000) {
      if (!OWNER_TOKEN.test(ownerToken) || !validLeaseMs(leaseMs)) throw new TypeError("INVALID_LEASE_REQUEST");
      const current = leases.get(id);
      if (current && current.expiresAt > now()) {
        const cause = new Error("TASK_LEASE_HELD"); cause.code = "TASK_LEASE_HELD"; throw cause;
      }
      const token = (fencing.get(id) || 0) + 1;
      if (!Number.isSafeInteger(token)) throw new Error("FENCING_TOKEN_EXHAUSTED");
      fencing.set(id, token);
      const lease = { ownerToken, fencingToken: token, acquiredAt: now(), expiresAt: now() + leaseMs };
      leases.set(id, lease); return { ...lease };
    },
    async renewLease(id, ownerToken, fencingToken, leaseMs = 30_000) {
      if (!validLeaseMs(leaseMs)) throw new TypeError("INVALID_LEASE_REQUEST");
      const current = assertLease(id, ownerToken, fencingToken);
      const renewed = { ...current, expiresAt: now() + leaseMs };
      leases.set(id, renewed); return { ...renewed };
    },
    async releaseLease(id, ownerToken, fencingToken) {
      assertLease(id, ownerToken, fencingToken); leases.delete(id); return true;
    },
    async claimEffect(id, ownerToken, fencingToken, effectKey, payload) {
      assertLease(id, ownerToken, fencingToken);
      if (typeof effectKey !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(effectKey)) throw new TypeError("INVALID_EFFECT_KEY");
      const key = id + ":" + effectKey;
      const hash = await payloadDigest(payload);
      const current = effects.get(key);
      if (current) {
        if (current.payloadHash !== hash) { const cause=new Error("IDEMPOTENCY_KEY_CONFLICT"); cause.code="IDEMPOTENCY_KEY_CONFLICT"; throw cause; }
        if (current.status === "completed") return { replay: true, result: clone(current.result) };
        const cause=new Error("EFFECT_OUTCOME_UNKNOWN"); cause.code="EFFECT_OUTCOME_UNKNOWN"; throw cause;
      }
      const count = [...effects.keys()].filter(item => item.startsWith(id + ":")).length;
      if (count >= 128) { const cause=new Error("EFFECT_LEDGER_LIMIT"); cause.code="EFFECT_LEDGER_LIMIT"; throw cause; }
      effects.set(key, { status: "started", payloadHash: hash, fencingToken, startedAt: now() });
      return { replay: false, payloadHash: hash };
    },
    async completeEffect(id, ownerToken, fencingToken, effectKey, payloadHash, result) {
      assertLease(id, ownerToken, fencingToken);
      const key = id + ":" + effectKey, current = effects.get(key);
      if (!current || current.status !== "started" || current.payloadHash !== payloadHash || current.fencingToken !== fencingToken) {
        const cause=new Error("EFFECT_CLAIM_NOT_OWNED"); cause.code="EFFECT_CLAIM_NOT_OWNED"; throw cause;
      }
      const completed = { ...current, status: "completed", result: clone(result), completedAt: now() };
      effects.set(key, completed); return clone(completed);
    },
    async getEffect(id, ownerToken, fencingToken, effectKey) {
      assertLease(id, ownerToken, fencingToken);
      const effect = effects.get(id + ":" + effectKey);
      return effect ? clone(effect) : null;
    },
  });
}

export function createDurableExecutionEngine({
  store, executeStep, now = () => Date.now(), audit = null,
  ownerTokenFactory = randomOwnerToken, defaultLeaseMs = 30_000,
} = {}) {
  const required = ["get", "put", "acquireLease", "renewLease", "releaseLease", "claimEffect", "completeEffect", "getEffect"];
  if (!store || required.some(name => typeof store[name] !== "function")) throw new TypeError("LEASE_IDEMPOTENCY_CHECKPOINT_STORE_REQUIRED");
  if (typeof executeStep !== "function") throw new TypeError("STEP_EXECUTOR_REQUIRED");
  if (typeof now !== "function" || typeof ownerTokenFactory !== "function" ||
      !validLeaseMs(defaultLeaseMs) || (audit !== null && typeof audit.record !== "function")) throw new TypeError("INVALID_DEPENDENCY");
  const emit = event => { try { audit?.record(Object.freeze(event)); } catch { /* audit must not alter execution */ } };

  async function acquire(id, leaseMs) {
    if (!validLeaseMs(leaseMs)) throw new TypeError("INVALID_LEASE_DURATION");
    const ownerToken = await ownerTokenFactory();
    if (typeof ownerToken !== "string" || !OWNER_TOKEN.test(ownerToken)) throw new TypeError("INVALID_OWNER_TOKEN");
    const lease = await store.acquireLease(id, ownerToken, leaseMs);
    return { ownerToken, lease };
  }
  async function release(id, ownerToken, lease) {
    try { await store.releaseLease(id, ownerToken, lease.fencingToken); }
    catch (cause) { emit({ type: "lease_release_failed", taskId: id, code: errorCode(cause, "LEASE_RELEASE_FAILED") }); }
  }
  async function renew(id, ownerToken, lease, leaseMs) {
    return store.renewLease(id, ownerToken, lease.fencingToken, leaseMs);
  }
  async function save(state, lease) {
    const safe = bounded(state);
    if (!safe) return error("CHECKPOINT_INVALID_OR_TOO_LARGE");
    try { await store.put(state.id, safe, lease); return { ok: true, state: safe }; }
    catch (cause) { return error(errorCode(cause, "CHECKPOINT_WRITE_FAILED")); }
  }
  async function load(id) {
    if (typeof id !== "string" || !TASK_ID.test(id)) return error("INVALID_TASK_ID");
    try {
      const state = await store.get(id);
      if (!state) return error("TASK_NOT_FOUND");
      if (!plain(state) || state.version !== 1 || state.id !== id || !STATUSES.has(state.status) ||
          !validPlan(state.steps) || !Number.isSafeInteger(state.cursor) || state.cursor < 0 || state.cursor > state.steps.length ||
          !Array.isArray(state.results) || !Array.isArray(state.completedStepIds) ||
          state.results.length !== state.completedStepIds.length ||
          state.results.some((item, index) => !plain(item) || item.stepId !== state.completedStepIds[index] ||
            !state.steps.some(step => step.id === item.stepId) || typeof item.idempotencyKey !== "string") ||
          new Set(state.completedStepIds).size !== state.completedStepIds.length ||
          state.cursor !== state.completedStepIds.length) return error("CHECKPOINT_CORRUPT");
      return { ok: true, state };
    } catch { return error("CHECKPOINT_READ_FAILED"); }
  }
  async function withLease(id, leaseMs, callback) {
    let ownerToken, lease;
    try {
      ({ ownerToken, lease } = await acquire(id, leaseMs));
      return await callback(ownerToken, lease);
    } catch (cause) {
      return error(errorCode(cause, "LEASE_ACQUISITION_FAILED"));
    } finally {
      if (ownerToken && lease) await release(id, ownerToken, lease);
    }
  }
  async function create({ id, input = {}, steps, leaseMs = defaultLeaseMs } = {}) {
    if (typeof id !== "string" || !TASK_ID.test(id)) return error("INVALID_TASK_ID");
    if (!validPlan(steps)) return error("INVALID_EXECUTION_PLAN");
    const safeInput = bounded(input);
    if (safeInput === null) return error("INVALID_TASK_INPUT");
    return withLease(id, leaseMs, async (ownerToken, lease) => {
      const existing = await load(id);
      if (existing.ok) return error("TASK_ALREADY_EXISTS");
      if (existing.code !== "TASK_NOT_FOUND") return existing;
      lease = await renew(id, ownerToken, lease, leaseMs);
      const state = {
        version: 1, id, status: "ready", input: safeInput, steps: bounded(steps),
        cursor: 0, results: [], completedStepIds: [], pendingApproval: null, pendingEffect: null,
        createdAt: now(), updatedAt: now(), revision: 0, lastError: null,
      };
      const saved = await save(state, lease);
      if (saved.ok) emit({ type: "task_created", taskId: id, revision: 0, fencingToken: lease.fencingToken });
      return saved;
    });
  }
  async function pauseForApproval(state, step, lease) {
    let hash = 2166136261;
    for (const char of state.id + ":" + step.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    const approvalId = "appr_" + state.id.slice(0, 24) + "_" + step.id.slice(0, 24) + "_" + hash.toString(16).padStart(8, "0");
    const next = { ...state, status: "paused_approval", pendingApproval: {
      id: approvalId, stepId: step.id, requestedAt: now(), decision: "pending",
    }, updatedAt: now(), revision: state.revision + 1 };
    const saved = await save(next, lease);
    if (saved.ok) emit({ type: "approval_required", taskId: state.id, stepId: step.id, revision: next.revision });
    return saved.ok ? { ok: true, status: next.status, state: saved.state } : saved;
  }
  async function pauseForReconciliation(state, step, lease, reason) {
    const effectKey = state.id + ":" + step.id;
    const next = { ...state, status: "paused_reconciliation",
      pendingEffect: { stepId: step.id, effectKey, reason },
      lastError: "EFFECT_OUTCOME_UNKNOWN", updatedAt: now(), revision: state.revision + 1 };
    const saved = await save(next, lease);
    emit({ type: "effect_reconciliation_required", taskId: state.id, stepId: step.id, reason });
    return saved.ok ? { ok: true, status: next.status, state: saved.state } : saved;
  }
  async function executeWithHeartbeat(id, ownerToken, startingLease, leaseMs, context) {
    let lease = startingLease, renewalPromise = null, heartbeatError = null;
    const controller = new AbortController();
    const renewOnce = () => {
      if (!renewalPromise) {
        renewalPromise = renew(id, ownerToken, lease, leaseMs)
          .then(value => { lease = value; return value; })
          .catch(cause => { heartbeatError = cause; controller.abort(); throw cause; })
          .finally(() => { renewalPromise = null; });
      }
      return renewalPromise;
    };
    const interval = setInterval(() => {
      if (!renewalPromise && !heartbeatError) void renewOnce().catch(() => {});
    }, Math.max(1_000, Math.floor(leaseMs / 3)));
    try {
      const value = await executeStep({ ...context, signal: controller.signal });
      if (renewalPromise) await renewalPromise;
      if (heartbeatError) throw heartbeatError;
      lease = await renewOnce();
      return { value, lease };
    } finally {
      clearInterval(interval);
    }
  }
  async function run(id, { maxSteps = 8, leaseMs = defaultLeaseMs } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 16) return error("INVALID_RUN_BUDGET");
    return withLease(id, leaseMs, async (ownerToken, startingLease) => {
      let lease = startingLease;
      const loaded = await load(id);
      if (!loaded.ok) return loaded;
      let state = loaded.state;
      if (TERMINAL.has(state.status)) return { ok: state.status === "completed", status: state.status, state };
      if (PAUSED.has(state.status)) return { ok: true, status: state.status, state };
      lease = await renew(id, ownerToken, lease, leaseMs);
      state = { ...state, status: "running", updatedAt: now(), revision: state.revision + 1 };
      let saved = await save(state, lease);
      if (!saved.ok) return saved;
      state = saved.state;
      let executed = 0;
      while (state.cursor < state.steps.length && executed < maxSteps) {
        const step = state.steps[state.cursor];
        if (step.kind === "approval" || step.requiresApproval === true) return pauseForApproval(state, step, lease);
        const prior = state.results.find(result => result.stepId === step.id);
        if (prior) {
          lease = await renew(id, ownerToken, lease, leaseMs);
          state = { ...state, cursor: state.cursor + 1, updatedAt: now(), revision: state.revision + 1 };
          saved = await save(state, lease); if (!saved.ok) return saved;
          state = saved.state; continue;
        }
        const effectKey = state.id + ":" + step.id;
        const effectPayload = {
          stepId: step.id, kind: step.kind,
          input: step.input ?? state.input, results: clone(state.results),
        };
        lease = await renew(id, ownerToken, lease, leaseMs);
        let claim;
        try {
          claim = await store.claimEffect(id, ownerToken, lease.fencingToken, effectKey, effectPayload);
        } catch (cause) {
          if (errorCode(cause, "") === "EFFECT_OUTCOME_UNKNOWN") {
            return pauseForReconciliation(state, step, lease, "PREVIOUS_ATTEMPT_UNCONFIRMED");
          }
          return error(errorCode(cause, "EFFECT_CLAIM_FAILED"));
        }
        let result;
        if (claim.replay) {
          result = claim.result;
          emit({ type: "effect_replayed", taskId: id, stepId: step.id });
        } else {
          try {
            const execution = await executeWithHeartbeat(id, ownerToken, lease, leaseMs, {
              taskId: state.id, stepId: step.id, kind: step.kind,
              input: step.input ?? state.input, results: clone(state.results),
              idempotencyKey: effectKey,
            });
            result = execution.value;
            lease = execution.lease;
          } catch {
            return pauseForReconciliation(state, step, lease, "EXECUTOR_INTERRUPTED_OR_FAILED");
          }
          const safeResult = bounded(result);
          if (safeResult === null) return pauseForReconciliation(state, step, lease, "RESULT_INVALID_OR_TOO_LARGE");
          try {
            lease = await renew(id, ownerToken, lease, leaseMs);
            await store.completeEffect(id, ownerToken, lease.fencingToken, effectKey, claim.payloadHash, safeResult);
          } catch (cause) {
            return error(errorCode(cause, "EFFECT_COMPLETION_FAILED"));
          }
          result = safeResult;
        }
        const safeResult = bounded(result);
        if (safeResult === null) return error("EFFECT_RESULT_INVALID");
        lease = await renew(id, ownerToken, lease, leaseMs);
        const next = {
          ...state, results: [...state.results, { stepId: step.id, idempotencyKey: effectKey, value: safeResult, completedAt: now() }],
          completedStepIds: [...state.completedStepIds, step.id], cursor: state.cursor + 1,
          pendingEffect: null, updatedAt: now(), revision: state.revision + 1, lastError: null,
        };
        saved = await save(next, lease);
        if (!saved.ok) return saved;
        state = saved.state; executed++;
        emit({ type: "step_checkpointed", taskId: state.id, stepId: step.id, revision: state.revision, fencingToken: lease.fencingToken });
      }
      if (state.cursor === state.steps.length) {
        lease = await renew(id, ownerToken, lease, leaseMs);
        const completed = { ...state, status: "completed", updatedAt: now(), revision: state.revision + 1 };
        saved = await save(completed, lease);
        if (!saved.ok) return saved;
        emit({ type: "task_completed", taskId: state.id, revision: completed.revision });
        return { ok: true, status: "completed", state: saved.state };
      }
      lease = await renew(id, ownerToken, lease, leaseMs);
      const ready = { ...state, status: "ready", updatedAt: now(), revision: state.revision + 1 };
      saved = await save(ready, lease);
      return saved.ok ? { ok: true, status: "ready", state: saved.state, remainingSteps: state.steps.length - state.cursor } : saved;
    });
  }
  async function decideApproval(id, approvalId, decision, { leaseMs = defaultLeaseMs } = {}) {
    if (typeof approvalId !== "string" || !APPROVAL_ID.test(approvalId) || !["approve", "reject"].includes(decision)) return error("INVALID_APPROVAL_DECISION");
    return withLease(id, leaseMs, async (ownerToken, startingLease) => {
      const loaded = await load(id);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      if (state.status !== "paused_approval" || state.pendingApproval?.id !== approvalId) return error("APPROVAL_NOT_PENDING");
      const lease = await renew(id, ownerToken, startingLease, leaseMs);
      if (decision === "reject") {
        const cancelled = { ...state, status: "cancelled", pendingApproval: { ...state.pendingApproval, decision: "rejected", decidedAt: now() }, updatedAt: now(), revision: state.revision + 1 };
        const saved = await save(cancelled, lease);
        if (saved.ok) emit({ type: "approval_rejected", taskId: id, revision: cancelled.revision });
        return saved.ok ? { ok: true, status: "cancelled", state: saved.state } : saved;
      }
      const steps = state.steps.map(step => step.id === state.pendingApproval.stepId ? { ...step, kind: "task", requiresApproval: false } : step);
      const resumed = { ...state, steps, status: "ready", pendingApproval: { ...state.pendingApproval, decision: "approved", decidedAt: now() }, updatedAt: now(), revision: state.revision + 1 };
      const saved = await save(resumed, lease);
      if (saved.ok) emit({ type: "approval_granted", taskId: id, revision: resumed.revision });
      return saved.ok ? { ok: true, status: "ready", state: saved.state } : saved;
    });
  }
  async function cancel(id, { leaseMs = defaultLeaseMs } = {}) {
    return withLease(id, leaseMs, async (ownerToken, startingLease) => {
      const loaded = await load(id); if (!loaded.ok) return loaded;
      if (TERMINAL.has(loaded.state.status)) return error("TASK_ALREADY_TERMINAL");
      if (loaded.state.status === "paused_reconciliation") return error("EFFECT_RECONCILIATION_REQUIRED");
      const lease = await renew(id, ownerToken, startingLease, leaseMs);
      const state = { ...loaded.state, status: "cancelled", updatedAt: now(), revision: loaded.state.revision + 1 };
      const saved = await save(state, lease);
      return saved.ok ? { ok: true, status: "cancelled", state: saved.state } : saved;
    });
  }
  return Object.freeze({ create, run, get: load, decideApproval, cancel });
}
