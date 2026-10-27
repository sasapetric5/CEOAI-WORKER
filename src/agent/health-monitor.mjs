// CEOAI V5.0: bounded aggregate health metrics for agent executions.
// Stores aggregate counters only: never prompts, outputs, tool arguments, run IDs, or credentials.
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_DURATION_MS = 86_400_000;
const MAX_BUDGET_UNITS = 1_000_000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

export function createAgentHealthMonitor({ maxAgents = 64, now = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(maxAgents) || maxAgents < 1 || maxAgents > 256) {
    throw new TypeError("INVALID_HEALTH_MONITOR_LIMIT");
  }
  if (typeof now !== "function") throw new TypeError("INVALID_HEALTH_MONITOR_CLOCK");
  const stats = new Map();

  function safeSnapshot(agentId, state) {
    return {
      agentId,
      runs: state.runs,
      succeeded: state.succeeded,
      failed: state.failed,
      totalDurationMs: state.totalDurationMs,
      averageDurationMs: state.runs ? Math.round(state.totalDurationMs / state.runs) : 0,
      budgetUnits: state.budgetUnits,
      lastOutcome: state.lastOutcome,
      lastCode: state.lastCode,
      lastAt: state.lastAt,
    };
  }

  return Object.freeze({
    record({ agentId, outcome, durationMs, budgetUnits = 0, code } = {}) {
      if (typeof agentId !== "string" || !AGENT_ID.test(agentId) ||
          !["succeeded", "failed"].includes(outcome) ||
          !integer(durationMs, MAX_DURATION_MS) ||
          !integer(budgetUnits, MAX_BUDGET_UNITS) ||
          (code !== undefined && (typeof code !== "string" || !SAFE_CODE.test(code)))) {
        return { ok: false, code: "INVALID_HEALTH_METRIC" };
      }

      let timestamp;
      try { timestamp = now(); } catch { return { ok: false, code: "HEALTH_CLOCK_FAILED" }; }
      if (!integer(timestamp, MAX_TIMESTAMP)) return { ok: false, code: "HEALTH_CLOCK_FAILED" };

      let state = stats.get(agentId);
      if (!state) {
        if (stats.size >= maxAgents) return { ok: false, code: "HEALTH_CAPACITY_REACHED" };
        state = {
          runs: 0, succeeded: 0, failed: 0, totalDurationMs: 0, budgetUnits: 0,
          lastOutcome: null, lastCode: null, lastAt: null,
        };
      }

      // Saturate counters instead of allowing numeric overflow over long process lifetimes.
      state.runs = Math.min(Number.MAX_SAFE_INTEGER, state.runs + 1);
      state[outcome] = Math.min(Number.MAX_SAFE_INTEGER, state[outcome] + 1);
      state.totalDurationMs = Math.min(Number.MAX_SAFE_INTEGER, state.totalDurationMs + durationMs);
      state.budgetUnits = Math.min(Number.MAX_SAFE_INTEGER, state.budgetUnits + budgetUnits);
      state.lastOutcome = outcome;
      state.lastCode = code ?? null;
      state.lastAt = timestamp;
      stats.set(agentId, state);
      return { ok: true, stats: safeSnapshot(agentId, state) };
    },
    get(agentId) {
      if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) return null;
      const state = stats.get(agentId);
      return state ? safeSnapshot(agentId, state) : null;
    },
    list() {
      return [...stats.entries()]
        .map(([agentId, state]) => safeSnapshot(agentId, state))
        .sort((a, b) => a.agentId.localeCompare(b.agentId));
    },
    clear() { stats.clear(); },
    get size() { return stats.size; },
  });
}
