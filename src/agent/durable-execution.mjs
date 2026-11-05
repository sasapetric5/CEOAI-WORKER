// CEOAI Durable Execution Engine v1.0
// LangGraph-style checkpoint/resume semantics, implemented natively for Cloudflare Workers.
// Storage is injected: use a Durable Object-backed adapter in production and a test adapter locally.
// No model calls, network access, dynamic imports, or external dependencies.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const STEP_ID = /^[a-z][a-z0-9_-]{0,47}$/;
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_STATE_BYTES = 24_576;
const MAX_STEPS = 64;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const STATUSES = new Set(["ready", "running", "paused_approval", "failed", "completed", "cancelled"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

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
const error = code => ({ ok: false, code });
const clone = value => JSON.parse(JSON.stringify(value));

export function createMemoryCheckpointStore() {
  const records = new Map();
  return Object.freeze({
    async get(id) { const value = records.get(id); return value ? clone(value) : null; },
    async put(id, value) { records.set(id, clone(value)); return true; },
    async delete(id) { return records.delete(id); },
  });
}

export function createDurableExecutionEngine({ store, executeStep, now = () => Date.now(), audit = null } = {}) {
  if (!store || typeof store.get !== "function" || typeof store.put !== "function") throw new TypeError("CHECKPOINT_STORE_REQUIRED");
  if (typeof executeStep !== "function") throw new TypeError("STEP_EXECUTOR_REQUIRED");
  if (typeof now !== "function" || (audit !== null && typeof audit.record !== "function")) throw new TypeError("INVALID_DEPENDENCY");
  const emit = event => { try { audit?.record(Object.freeze(event)); } catch { /* audit must not alter execution */ } };

  async function save(state) {
    const safe = bounded(state);
    if (!safe) return error("CHECKPOINT_INVALID_OR_TOO_LARGE");
    try { await store.put(state.id, safe); return { ok: true, state: safe }; }
    catch { return error("CHECKPOINT_WRITE_FAILED"); }
  }
  async function load(id) {
    if (typeof id !== "string" || !TASK_ID.test(id)) return error("INVALID_TASK_ID");
    try {
      const state = await store.get(id);
      if (!state) return error("TASK_NOT_FOUND");
      if (!plain(state) || state.version !== 1 || state.id !== id || !STATUSES.has(state.status) ||
          !validPlan(state.steps) || !Number.isSafeInteger(state.cursor) || state.cursor < 0 || state.cursor > state.steps.length ||
          !Array.isArray(state.results) || !Array.isArray(state.completedStepIds)) return error("CHECKPOINT_CORRUPT");
      return { ok: true, state };
    } catch { return error("CHECKPOINT_READ_FAILED"); }
  }
  async function create({ id, input = {}, steps } = {}) {
    if (typeof id !== "string" || !TASK_ID.test(id)) return error("INVALID_TASK_ID");
    if (!validPlan(steps)) return error("INVALID_EXECUTION_PLAN");
    const safeInput = bounded(input);
    if (safeInput === null) return error("INVALID_TASK_INPUT");
    const existing = await load(id);
    if (existing.ok) return error("TASK_ALREADY_EXISTS");
    if (existing.code !== "TASK_NOT_FOUND") return existing;
    const state = {
      version: 1, id, status: "ready", input: safeInput, steps: bounded(steps),
      cursor: 0, results: [], completedStepIds: [], pendingApproval: null,
      createdAt: now(), updatedAt: now(), revision: 0, lastError: null,
    };
    const saved = await save(state);
    if (saved.ok) emit({ type: "task_created", taskId: id, revision: 0 });
    return saved;
  }
  async function pauseForApproval(state, step) {
    const approvalId = "approval_" + state.id + "_" + step.id;
    const next = { ...state, status: "paused_approval", pendingApproval: {
      id: approvalId, stepId: step.id, requestedAt: now(), decision: "pending",
    }, updatedAt: now(), revision: state.revision + 1 };
    const saved = await save(next);
    if (saved.ok) emit({ type: "approval_required", taskId: state.id, stepId: step.id, revision: next.revision });
    return saved.ok ? { ok: true, status: next.status, state: saved.state } : saved;
  }
  async function run(id, { maxSteps = 8, approved = false } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 16) return error("INVALID_RUN_BUDGET");
    let loaded = await load(id);
    if (!loaded.ok) return loaded;
    let state = loaded.state;
    if (TERMINAL.has(state.status)) return { ok: state.status === "completed", status: state.status, state };
    if (state.status === "paused_approval") return { ok: true, status: state.status, state };
    state = { ...state, status: "running", updatedAt: now(), revision: state.revision + 1 };
    let saved = await save(state);
    if (!saved.ok) return saved;
    state = saved.state;
    let executed = 0;
    while (state.cursor < state.steps.length && executed < maxSteps) {
      const step = state.steps[state.cursor];
      if (step.kind === "approval" || step.requiresApproval === true) {
        if (!approved) return pauseForApproval(state, step);
      }
      const prior = state.results.find(result => result.stepId === step.id);
      if (prior) {
        state = { ...state, cursor: state.cursor + 1, updatedAt: now(), revision: state.revision + 1 };
        saved = await save(state); if (!saved.ok) return saved;
        state = saved.state; continue;
      }
      const idempotencyKey = state.id + ":" + step.id;
      let result;
      try {
        result = await executeStep({
          taskId: state.id, stepId: step.id, kind: step.kind,
          input: step.input ?? state.input, results: clone(state.results),
          idempotencyKey, signal: undefined,
        });
      } catch {
        const failed = { ...state, status: "failed", lastError: "STEP_EXECUTION_FAILED", updatedAt: now(), revision: state.revision + 1 };
        const failureSave = await save(failed);
        emit({ type: "step_failed", taskId: state.id, stepId: step.id });
        return failureSave.ok ? error("STEP_EXECUTION_FAILED") : failureSave;
      }
      const safeResult = bounded(result);
      if (safeResult === null) return error("STEP_RESULT_INVALID_OR_TOO_LARGE");
      const next = {
        ...state, results: [...state.results, { stepId: step.id, idempotencyKey, value: safeResult, completedAt: now() }],
        completedStepIds: [...state.completedStepIds, step.id], cursor: state.cursor + 1,
        updatedAt: now(), revision: state.revision + 1, lastError: null,
      };
      saved = await save(next);
      if (!saved.ok) return saved;
      state = saved.state; executed++;
      emit({ type: "step_checkpointed", taskId: state.id, stepId: step.id, revision: state.revision });
    }
    if (state.cursor === state.steps.length) {
      const completed = { ...state, status: "completed", updatedAt: now(), revision: state.revision + 1 };
      saved = await save(completed);
      if (!saved.ok) return saved;
      emit({ type: "task_completed", taskId: state.id, revision: completed.revision });
      return { ok: true, status: "completed", state: saved.state };
    }
    const ready = { ...state, status: "ready", updatedAt: now(), revision: state.revision + 1 };
    saved = await save(ready);
    return saved.ok ? { ok: true, status: "ready", state: saved.state, remainingSteps: state.steps.length - state.cursor } : saved;
  }
  async function decideApproval(id, approvalId, decision) {
    if (typeof approvalId !== "string" || !APPROVAL_ID.test(approvalId) || !["approve", "reject"].includes(decision)) return error("INVALID_APPROVAL_DECISION");
    const loaded = await load(id);
    if (!loaded.ok) return loaded;
    const state = loaded.state;
    if (state.status !== "paused_approval" || state.pendingApproval?.id !== approvalId) return error("APPROVAL_NOT_PENDING");
    if (decision === "reject") {
      const cancelled = { ...state, status: "cancelled", pendingApproval: { ...state.pendingApproval, decision: "rejected", decidedAt: now() }, updatedAt: now(), revision: state.revision + 1 };
      const saved = await save(cancelled);
      if (saved.ok) emit({ type: "approval_rejected", taskId: id, revision: cancelled.revision });
      return saved.ok ? { ok: true, status: "cancelled", state: saved.state } : saved;
    }
    const steps = state.steps.map(step => step.id === state.pendingApproval.stepId ? { ...step, kind: "task", requiresApproval: false } : step);
    const resumed = { ...state, steps, status: "ready", pendingApproval: { ...state.pendingApproval, decision: "approved", decidedAt: now() }, updatedAt: now(), revision: state.revision + 1 };
    const saved = await save(resumed);
    if (saved.ok) emit({ type: "approval_granted", taskId: id, revision: resumed.revision });
    return saved.ok ? { ok: true, status: "ready", state: saved.state } : saved;
  }
  async function cancel(id) {
    const loaded = await load(id); if (!loaded.ok) return loaded;
    if (TERMINAL.has(loaded.state.status)) return error("TASK_ALREADY_TERMINAL");
    const state = { ...loaded.state, status: "cancelled", updatedAt: now(), revision: loaded.state.revision + 1 };
    const saved = await save(state);
    return saved.ok ? { ok: true, status: "cancelled", state: saved.state } : saved;
  }
  return Object.freeze({ create, run, get: load, decideApproval, cancel });
}
