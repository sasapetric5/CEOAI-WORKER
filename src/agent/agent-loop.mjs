// Bounded orchestration primitive. Does not call an LLM or external services.
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

export function createAgentLoop({ toolRegistry, skillRegistry, maxSteps = 4, maxToolCalls = 4 } = {}) {
  if (!toolRegistry || typeof toolRegistry.execute !== "function" || typeof toolRegistry.get !== "function") throw new TypeError("TOOL_REGISTRY_REQUIRED");
  if (!skillRegistry || typeof skillRegistry.allows !== "function" || typeof skillRegistry.get !== "function") throw new TypeError("SKILL_REGISTRY_REQUIRED");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 8) throw new TypeError("INVALID_MAX_STEPS");
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 8) throw new TypeError("INVALID_MAX_TOOL_CALLS");

  return Object.freeze({
    async run({ skillId, input, plan, allowToolExecution = false, allowedToolIds = [], budget } = {}) {
      if (allowToolExecution !== true) return fail("EXECUTION_NOT_APPROVED", 0, 0);
      const skill = skillRegistry.get(skillId);
      if (!skill) return fail("SKILL_NOT_FOUND", 0, 0);
      if (typeof plan !== "function") return fail("PLANNER_REQUIRED", 0, 0);
      if (!Array.isArray(allowedToolIds) || allowedToolIds.some((id) => typeof id !== "string")) return fail("INVALID_CAPABILITIES", 0, 0);
      if (!withinContextLimit(input)) return fail("INPUT_TOO_LARGE_OR_INVALID", 0, 0);
      const sharedBudget = budget === undefined ? createAgentBudget({ maxToolCalls }) : budget;
      const budgetData = budgetState.get(sharedBudget);
      if (!budgetData) return fail("INVALID_AGENT_BUDGET", 0, 0);
      const capabilities = new Set(allowedToolIds.filter((id) => skillRegistry.allows(skillId, id)));
      let current = input;
      let toolCalls = 0;
      for (let step = 1; step <= maxSteps; step++) {
        let decision;
        try {
          decision = await plan({ skillId, step, input: current, availableToolIds: skill.allowedToolIds.filter((id) => capabilities.has(id)), toolCalls, budgetUsed: budgetData.used, budgetRemaining: Math.max(0, budgetData.maxToolCalls - budgetData.used) });
        } catch {
          return fail("PLANNER_FAILED", step, toolCalls);
        }
        if (!plain(decision) || !["final", "tool"].includes(decision.type)) return fail("INVALID_PLAN", step, toolCalls);
        if (decision.type === "final") {
          if (!Object.hasOwn(decision, "output")) return fail("INVALID_PLAN", step, toolCalls);
          let serialized;
          try { serialized = JSON.stringify(decision.output); } catch { return fail("INVALID_FINAL_OUTPUT", step, toolCalls); }
          if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > 8192) return fail("INVALID_FINAL_OUTPUT", step, toolCalls);
          return { ok: true, output: JSON.parse(serialized), steps: step, toolCalls, budgetUsed: budgetData.used };
        }
        if (toolCalls >= maxToolCalls) return fail("AGENT_TOOL_CALL_LIMIT", step, toolCalls);
        if (budgetData.used >= budgetData.maxToolCalls) return fail("AGENT_SHARED_BUDGET_EXHAUSTED", step, toolCalls);
        if (typeof decision.toolId !== "string" || !capabilities.has(decision.toolId) || !skillRegistry.allows(skillId, decision.toolId)) return fail("TOOL_CAPABILITY_DENIED", step, toolCalls);
        // Reserve before awaiting: concurrent runs sharing this token cannot overspend.
        budgetData.used++;
        let result;
        try {
          result = await toolRegistry.execute(decision.toolId, decision.arguments, { allowToolExecution: true, allowedToolIds: [...capabilities] }, { calls: toolCalls });
        } catch {
          return fail("TOOL_EXECUTION_FAILED", step, toolCalls);
        }
        if (!result || result.ok !== true) return fail(result?.code || "TOOL_EXECUTION_FAILED", step, toolCalls);
        toolCalls++;
        const nextContext = { previous: current, tool: decision.toolId, result: result.result };
        if (!withinContextLimit(nextContext)) return fail("AGENT_CONTEXT_TOO_LARGE", step, toolCalls);
        current = nextContext;
      }
      return fail("AGENT_STEP_LIMIT", maxSteps, toolCalls);
    },
  });
}
