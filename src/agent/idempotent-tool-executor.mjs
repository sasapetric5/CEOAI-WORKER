// Durable idempotency boundary for tool side effects.
// One stable key maps to one Durable Object task and one effect-ledger entry.
// Unknown outcomes are surfaced for reconciliation; they are never retried silently.
import { createDurableExecutionEngine } from "./durable-execution.mjs";

const TOOL_ID = /^[a-z][a-z0-9_]{0,47}$/;
const KEY = /^[A-Za-z0-9:._-]{1,256}$/;
const MAX_BYTES = 24_576;
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
  if (array && (keys.length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, String(index))).some(present => !present))) return undefined;
  if (keys.some(key => typeof key !== "string" || (array && key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))) return undefined;
  const output = array ? [] : Object.create(null);
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return undefined;
    const child = snapshot(descriptor.value, seen, depth + 1);
    if (child === undefined) return undefined;
    if (array) output[Number(key)] = child;
    else output[key] = child;
  }
  seen.delete(value);
  if (array && output.length !== value.length) return undefined;
  return output;
}
function encode(value) {
  const safe = snapshot(value);
  if (safe === undefined) return null;
  let json;
  try { json = JSON.stringify(safe); } catch { return null; }
  return typeof json === "string" && new TextEncoder().encode(json).byteLength <= MAX_BYTES ? json : null;
}
async function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + (await Promise.all(value.map(canonical))).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + (await Promise.all(keys.map(async key => JSON.stringify(key) + ":" + await canonical(value[key])))).join(",") + "}";
}
async function taskIdFor(key) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return "tool_" + [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function createIdempotentToolExecutor({ store, now = () => Date.now(), audit = null } = {}) {
  const required = ["get", "put", "acquireLease", "renewLease", "releaseLease", "claimEffect", "completeEffect", "getEffect"];
  if (!store || required.some(name => typeof store[name] !== "function")) throw new TypeError("DURABLE_EFFECT_STORE_REQUIRED");
  if (typeof now !== "function" || (audit !== null && typeof audit.record !== "function")) throw new TypeError("INVALID_IDEMPOTENCY_DEPENDENCY");

  async function execute({ idempotencyKey, toolId, arguments: toolArguments = {}, context = {}, execute: executeTool } = {}) {
    if (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey) ||
        typeof toolId !== "string" || !TOOL_ID.test(toolId) || typeof executeTool !== "function") {
      return { ok: false, code: "INVALID_IDEMPOTENT_TOOL_REQUEST" };
    }
    const payload = { toolId, arguments: toolArguments, context };
    const encoded = encode(payload);
    if (encoded === null) return { ok: false, code: "INVALID_IDEMPOTENT_TOOL_PAYLOAD" };
    const safePayload = JSON.parse(encoded);
    let taskId;
    try { taskId = await taskIdFor(idempotencyKey); }
    catch { return { ok: false, code: "IDEMPOTENCY_HASH_UNAVAILABLE" }; }

    const engine = createDurableExecutionEngine({
      store, now, audit,
      executeStep: async ({ idempotencyKey: durableEffectKey, signal }) => executeTool({
        toolId: safePayload.toolId,
        arguments: safePayload.arguments,
        context: safePayload.context,
        idempotencyKey: durableEffectKey,
        signal,
      }),
    });
    const steps = [{ id: "execute_tool", kind: "task", input: safePayload }];
    const created = await engine.create({ id: taskId, input: safePayload, steps });
    let existed = false;
    let wasCompleted = false;
    if (!created.ok) {
      if (created.code !== "TASK_ALREADY_EXISTS") return created;
      const current = await engine.get(taskId);
      if (!current.ok) return current;
      let sameInput = false;
      let sameSteps = false;
      try {
        sameInput = await canonical(current.state.input) === await canonical(safePayload);
        sameSteps = await canonical(current.state.steps) === await canonical(steps);
      } catch { /* malformed stored state is rejected below */ }
      if (!sameInput || !sameSteps) return { ok: false, code: "IDEMPOTENCY_KEY_CONFLICT" };
      existed = true;
      wasCompleted = current.state.status === "completed";
    }

    const result = await engine.run(taskId, { maxSteps: 1 });
    if (result.status === "paused_reconciliation") {
      return { ok: false, code: "EFFECT_OUTCOME_UNKNOWN", status: result.status, taskId, reconciliationRequired: true };
    }
    if (!result.ok || result.status !== "completed" || !result.state?.results?.[0]) {
      return { ok: false, code: result.code || "IDEMPOTENT_TOOL_EXECUTION_FAILED", status: result.status, taskId };
    }
    try {
      audit?.record({ type: wasCompleted ? "tool_effect_replayed" : "tool_effect_completed", taskId, toolId });
    } catch { /* audit must not alter execution */ }
    return {
      ok: true,
      result: result.state.results[0].value,
      idempotencyKey: taskId + ":execute_tool",
      replayed: existed && wasCompleted,
      taskId,
    };
  }

  return Object.freeze({ execute });
}
