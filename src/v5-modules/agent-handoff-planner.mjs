// CEOAI V5.0 — deterministic planning of a bounded agent handoff chain.
// Produces envelopes only. It does not invoke models, execute code, or call external services.
import { createTaskPlan } from "./task-orchestrator.mjs";
import { createAgentHandoff } from "./agent-handoff-contract.mjs";

export function createAgentHandoffPlan(registry, request, options = {}) {
  const plan = createTaskPlan(registry, request, options);
  const agents = plan.selected_agents.map(agent => agent.id);
  const handoffs = [];
  for (let i = 0; i + 1 < agents.length; i += 1) {
    const from = agents[i];
    const to = agents[i + 1];
    const envelope = createAgentHandoff({
      task_id: options.taskId ?? "task-" + plan.task_type + "-" + plan.request_chars,
      from,
      to,
      payload: "Review task plan for task type '" + plan.task_type +
        "' (" + plan.request_chars + " request characters). Use only approved, non-sensitive task context.",
      created_at: options.createdAt,
    });
    handoffs.push(envelope);
  }
  return {
    schema_version: "1.0.0",
    mode: "handoff-plan-only",
    task_type: plan.task_type,
    agent_ids: agents,
    handoffs,
    limits: {
      max_agents: plan.handoff_policy.max_agents,
      max_handoffs: Math.max(0, plan.handoff_policy.max_agents - 1),
    },
    policy: {
      execution_allowed: false,
      automatic_tool_execution_allowed: false,
      external_actions_allowed: false,
      paid_services_allowed: false,
      execution_started: false,
    },
    block_reason: "handoff-plan-only-no-agent-runtime",
  };
}
