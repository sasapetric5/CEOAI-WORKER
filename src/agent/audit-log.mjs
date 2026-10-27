// CEOAI V5.0: bounded, privacy-preserving agent audit events.
// Deliberately excludes prompts, tool arguments, outputs, credentials, and arbitrary metadata.
const EVENT_TYPES = new Set(["run_started", "run_succeeded", "run_failed", "tool_reserved", "tool_succeeded", "tool_failed"]);
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const integer = (value, max = 1_000_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;

export function createAgentAuditLog({ maxEvents = 100, now = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 1000) throw new TypeError("INVALID_AUDIT_LIMIT");
  if (typeof now !== "function") throw new TypeError("INVALID_AUDIT_CLOCK");
  const events = [];

  return Object.freeze({
    record(event = {}) {
      if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, code: "INVALID_AUDIT_EVENT" };
      const { type, runId, code, step, toolCalls, durationMs } = event;
      if (!EVENT_TYPES.has(type) || typeof runId !== "string" || !RUN_ID.test(runId)) return { ok: false, code: "INVALID_AUDIT_EVENT" };
      if (code !== undefined && (typeof code !== "string" || !CODE.test(code))) return { ok: false, code: "INVALID_AUDIT_EVENT" };
      if (step !== undefined && !integer(step, 1000)) return { ok: false, code: "INVALID_AUDIT_EVENT" };
      if (toolCalls !== undefined && !integer(toolCalls, 1000)) return { ok: false, code: "INVALID_AUDIT_EVENT" };
      if (durationMs !== undefined && !integer(durationMs, 86_400_000)) return { ok: false, code: "INVALID_AUDIT_EVENT" };
      let timestamp;
      try { timestamp = now(); } catch { return { ok: false, code: "AUDIT_CLOCK_FAILED" }; }
      if (!integer(timestamp, 8_640_000_000_000_000)) return { ok: false, code: "AUDIT_CLOCK_FAILED" };
      const safe = { timestamp, type, runId };
      if (code !== undefined) safe.code = code;
      if (step !== undefined) safe.step = step;
      if (toolCalls !== undefined) safe.toolCalls = toolCalls;
      if (durationMs !== undefined) safe.durationMs = durationMs;
      events.push(Object.freeze(safe));
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
      return { ok: true, event: { ...safe } };
    },
    list({ runId, limit = maxEvents } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > maxEvents) return [];
      if (runId !== undefined && (typeof runId !== "string" || !RUN_ID.test(runId))) return [];
      const filtered = runId === undefined ? events : events.filter(e => e.runId === runId);
      return filtered.slice(-limit).map(event => ({ ...event }));
    },
    clear() { events.length = 0; },
    get size() { return events.length; },
  });
}
