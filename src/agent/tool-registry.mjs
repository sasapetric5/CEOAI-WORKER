// CEOAI V5.0: safe, inactive-by-default tool registry. No network or dynamic code loading.
export const TOOL_REGISTRY_VERSION = "1.0.0";
export const DEFAULT_TOOL_LIMITS = Object.freeze({ maxCalls: 4, timeoutMs: 2000, maxOutputBytes: 8192 });
const ID = /^[a-z][a-z0-9_]{0,47}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const error = (code) => ({ ok: false, code });

function validSchema(s) {
  if (!plain(s) || s.type !== "object" || !plain(s.properties) || s.additionalProperties !== false) return false;
  const keys = Object.keys(s.properties);
  if (keys.some((k) => !ID.test(k) || RESERVED.has(k))) return false;
  if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some((k) => !keys.includes(k))) ) return false;
  for (const r of Object.values(s.properties)) {
    if (!plain(r) || !["string", "number", "integer", "boolean"].includes(r.type)) return false;
    if (r.type === "string" && r.maxLength !== undefined && (!Number.isSafeInteger(r.maxLength) || r.maxLength < 0 || r.maxLength > 4096)) return false;
    if (["number", "integer"].includes(r.type)) {
      if (r.minimum !== undefined && !Number.isFinite(r.minimum)) return false;
      if (r.maximum !== undefined && !Number.isFinite(r.maximum)) return false;
      if (r.minimum !== undefined && r.maximum !== undefined && r.minimum > r.maximum) return false;
    }
  }
  return true;
}
function publicDefinition(t) {
  return Object.freeze({ id: t.id, description: t.description, inputSchema: structuredClone(t.inputSchema), limits: Object.freeze({ ...t.limits }) });
}
function validLimits(limits) {
  for (const [key, value] of Object.entries(limits)) {
    if (!["maxCalls", "timeoutMs", "maxOutputBytes"].includes(key) || !Number.isSafeInteger(value) || value <= 0 || value > 60000) throw new TypeError("INVALID_LIMIT:" + key);
  }
}

export function createToolRegistry({ tools = [], enabled = false, limits = {} } = {}) {
  const baseLimits = { ...DEFAULT_TOOL_LIMITS, ...limits };
  validLimits(baseLimits);
  const definitions = new Map();
  for (const t of tools) {
    if (!plain(t) || typeof t.id !== "string" || !ID.test(t.id) || RESERVED.has(t.id)) throw new TypeError("INVALID_TOOL_ID");
    if (definitions.has(t.id)) throw new TypeError("DUPLICATE_TOOL:" + t.id);
    if (typeof t.description !== "string" || !t.description.trim() || t.description.length > 240) throw new TypeError("INVALID_TOOL_DESCRIPTION:" + t.id);
    if (!validSchema(t.inputSchema)) throw new TypeError("INVALID_TOOL_SCHEMA:" + t.id);
    if (typeof t.handler !== "function") throw new TypeError("INVALID_TOOL_HANDLER:" + t.id);
    const toolLimits = { ...baseLimits, ...(t.limits || {}) };
    validLimits(toolLimits);
    definitions.set(t.id, { id: t.id, description: t.description.trim(), inputSchema: structuredClone(t.inputSchema), handler: t.handler, limits: toolLimits });
  }
  const registry = {
    version: TOOL_REGISTRY_VERSION,
    enabled: enabled === true,
    list() { return [...definitions.values()].map(publicDefinition); },
    get(id) { const t = definitions.get(id); return t ? publicDefinition(t) : null; },
    validate(id, input) {
      const t = definitions.get(id);
      if (!t) return error("TOOL_NOT_FOUND");
      if (!plain(input)) return error("INVALID_ARGUMENTS");
      const props = t.inputSchema.properties;
      if (Object.keys(input).some((k) => !Object.hasOwn(props, k) || RESERVED.has(k))) return error("UNKNOWN_ARGUMENT");
      for (const k of t.inputSchema.required || []) if (!Object.hasOwn(input, k)) return error("MISSING_ARGUMENT");
      for (const [k, v] of Object.entries(input)) {
        const r = props[k];
        if (r.type === "string" && (typeof v !== "string" || (r.maxLength !== undefined && v.length > r.maxLength))) return error("INVALID_ARGUMENT_TYPE");
        if (r.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) return error("INVALID_ARGUMENT_TYPE");
        if (r.type === "integer" && !Number.isSafeInteger(v)) return error("INVALID_ARGUMENT_TYPE");
        if (r.type === "boolean" && typeof v !== "boolean") return error("INVALID_ARGUMENT_TYPE");
        if (typeof v === "number" && ((r.minimum !== undefined && v < r.minimum) || (r.maximum !== undefined && v > r.maximum))) return error("ARGUMENT_OUT_OF_RANGE");
      }
      return { ok: true, value: structuredClone(input) };
    },
    async execute(id, input, context = {}, state = {}) {
      if (!registry.enabled) return error("TOOLS_DISABLED");
      const t = definitions.get(id);
      if (!t) return error("TOOL_NOT_FOUND");
      if (!plain(context) || !plain(state)) return error("INVALID_EXECUTION_CONTEXT");
      if (context.allowToolExecution !== true) return error("EXECUTION_NOT_APPROVED");
      if (context.allowedToolIds !== undefined && (!Array.isArray(context.allowedToolIds) || !context.allowedToolIds.includes(id))) return error("TOOL_CAPABILITY_DENIED");
      const checked = registry.validate(id, input);
      if (!checked.ok) return checked;
      const calls = Number.isSafeInteger(state.calls) && state.calls >= 0 ? state.calls : 0;
      if (calls >= t.limits.maxCalls) return error("TOOL_CALL_LIMIT");
      const controller = new AbortController();
      let timer;
      let timedOut = false;
      // Attach both handlers immediately. A late rejection remains observed after timeout.
      const handlerPromise = Promise.resolve().then(() => t.handler(checked.value, { signal: controller.signal }));
      handlerPromise.catch(() => {});
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("TOOL_TIMEOUT"));
          controller.abort();
        }, t.limits.timeoutMs);
      });
      try {
        const result = await Promise.race([handlerPromise, timeoutPromise]);
        if (timedOut) return error("TOOL_TIMEOUT");
        let json;
        try { json = JSON.stringify(result); } catch { return error("INVALID_TOOL_OUTPUT"); }
        if (typeof json !== "string") return error("INVALID_TOOL_OUTPUT");
        if (new TextEncoder().encode(json).byteLength > t.limits.maxOutputBytes) return error("TOOL_OUTPUT_TOO_LARGE");
        return { ok: true, result: JSON.parse(json), calls: calls + 1 };
      } catch (e) {
        return error(timedOut || e?.message === "TOOL_TIMEOUT" ? "TOOL_TIMEOUT" : "TOOL_EXECUTION_FAILED");
      } finally {
        if (timer) clearTimeout(timer);
        if (!controller.signal.aborted && timedOut) controller.abort();
      }
    },
  };
  return Object.freeze(registry);
}
