// Bounded orchestration primitive. Does not call an LLM or external services.
import { createToolSession } from "./tool-registry.mjs";
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const MAX_CONTEXT_BYTES = 8192;
function withinContextLimit(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && new TextEncoder().encode(serialized).byteLength <= MAX_CONTEXT_BYTES;
  } catch { return false; }
}
const fail = (code, steps, toolCalls) => ({ ok: false, code, steps, toolCalls });
const budgetState = new WeakMap();

export function createAgentBudget({ maxToolCalls = 4 } = {}) {
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 8) throw new TypeError("INVALID_BUDGET_LIMIT");
  const token = Object.freeze({});
  budgetState.set(token, { maxToolCalls, used: 0 });
  return token;
}

export function createAgentLoop({ toolRegistry, skillRegistry, maxSteps = 4, maxToolCalls = 4, auditLog = null } = {}) {
  if (!toolRegistry || typeof toolRegistry.execute !== "function" || typeof toolRegistry.get !== "function") throw new TypeError("TOOL_REGISTRY_REQUIRED");
  if (!skillRegistry || typeof skillRegistry.allows !== "function" || typeof skillRegistry.get !== "function") throw new TypeError("SKILL_REGISTRY_REQUIRED");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 8) throw new TypeError("INVALID_MAX_STEPS");
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 8) throw new TypeError("INVALID_MAX_TOOL_CALLS");

  if (auditLog !== null && typeof auditLog.record !== "function") throw new TypeError("INVALID_AUDIT_LOG");
  const audit = (event) => { try { auditLog?.record(event); } catch { /* auditing must not change agent results */ } };

  return Object.freeze({
    async run({ skillId, input, plan, allowToolExecution = false, allowedToolIds = [], budget, runId = crypto.randomUUID() } = {}) {
      if (allowToolExecution !== true) return fail("EXECUTION_NOT_APPROVED", 0, 0);
      const skill = skillRegistry.get(skillId);
      if (!skill) return fail("SKILL_NOT_FOUND", 0, 0);
      if (typeof plan !== "function") return fail("PLANNER_REQUIRED", 0, 0);
      if (!Array.isArray(allowedToolIds) || allowedToolIds.some((id) => typeof id !== "string")) return fail("INVALID_CAPABILITIES", 0, 0);
      if (!withinContextLimit(input)) return fail("INPUT_TOO_LARGE_OR_INVALID", 0, 0);
      const sharedBudget = budget === undefined ? createAgentBudget({ maxToolCalls }) : budget;
      const budgetData = budgetState.get(sharedBudget);
      if (!budgetData) return fail("INVALID_AGENT_BUDGET", 0, 0);
      audit({ type: "run_started", runId });
      const failRun = (code, steps, calls) => { audit({ type: "run_failed", runId, code: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "AGENT_FAILED", step: steps, toolCalls: calls }); return fail(code, steps, calls); };
      const capabilities = new Set(allowedToolIds.filter((id) => skillRegistry.allows(skillId, id)));
      const toolSession = createToolSession({ maxCalls: maxToolCalls });
      let current = input;
      let toolCalls = 0;
      for (let step = 1; step <= maxSteps; step++) {
        let decision;
        try {
          decision = await plan({ skillId, step, input: current, availableToolIds: skill.allowedToolIds.filter((id) => capabilities.has(id)), toolCalls, budgetUsed: budgetData.used, budgetRemaining: Math.max(0, budgetData.maxToolCalls - budgetData.used) });
        } catch {
          return failRun("PLANNER_FAILED", step, toolCalls);
        }
        if (!plain(decision) || !["final", "tool"].includes(decision.type)) return failRun("INVALID_PLAN", step, toolCalls);
        if (decision.type === "final") {
          if (!Object.hasOwn(decision, "output")) return failRun("INVALID_PLAN", step, toolCalls);
          let serialized;
          try { serialized = JSON.stringify(decision.output); } catch { return fail("INVALID_FINAL_OUTPUT", step, toolCalls); }
          if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > 8192) return failRun("INVALID_FINAL_OUTPUT", step, toolCalls);
          audit({ type: "run_succeeded", runId, step, toolCalls });
          return { ok: true, output: JSON.parse(serialized), steps: step, toolCalls, budgetUsed: budgetData.used };
        }
        if (toolCalls >= maxToolCalls) return failRun("AGENT_TOOL_CALL_LIMIT", step, toolCalls);
        if (budgetData.used >= budgetData.maxToolCalls) return failRun("AGENT_SHARED_BUDGET_EXHAUSTED", step, toolCalls);
        if (typeof decision.toolId !== "string" || !capabilities.has(decision.toolId) || !skillRegistry.allows(skillId, decision.toolId)) return failRun("TOOL_CAPABILITY_DENIED", step, toolCalls);
        // Reserve before awaiting: concurrent runs sharing this token cannot overspend.
        budgetData.used++;
        audit({ type: "tool_reserved", runId, step, toolCalls });
        let result;
        try {
          result = await toolRegistry.execute(decision.toolId, decision.arguments, { allowToolExecution: true, allowedToolIds: [...capabilities], session: toolSession }, { calls: toolCalls });
        } catch {
          audit({ type: "tool_failed", runId, code: "TOOL_EXECUTION_FAILED", step, toolCalls });
          audit({ type: "run_failed", runId, code: "TOOL_EXECUTION_FAILED", step, toolCalls });
          return failRun("TOOL_EXECUTION_FAILED", step, toolCalls);
        }
        if (!result || result.ok !== true) {
          const code = typeof result?.code === "string" ? result.code : "TOOL_EXECUTION_FAILED";
          const safeCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "TOOL_EXECUTION_FAILED";
          audit({ type: "tool_failed", runId, code: safeCode, step, toolCalls });
          audit({ type: "run_failed", runId, code: safeCode, step, toolCalls });
          return failRun(code, step, toolCalls);
        }
        toolCalls++;
        audit({ type: "tool_succeeded", runId, step, toolCalls });
        const nextContext = { previous: current, tool: decision.toolId, result: result.result };
        if (!withinContextLimit(nextContext)) return failRun("AGENT_CONTEXT_TOO_LARGE", step, toolCalls);
        current = nextContext;
      }
      return failRun("AGENT_STEP_LIMIT", maxSteps, toolCalls);
    },
  });
}
