// CEOAI V5.0 — fail-closed gate for a future agent runtime.
// This module does not run agents. It only determines whether prerequisites exist.
export function evaluateAgentRuntimeGate(env = {}, dependencies = {}) {
  const blockers = [];
  if (env.CEOAI_AGENT_RUNTIME_ENABLED !== "true") blockers.push("runtime_not_explicitly_enabled");
  if (env.CEOAI_AGENT_RUNTIME_FREE_ONLY !== "true") blockers.push("free_only_policy_not_confirmed");
  if (env.CEOAI_AGENT_RUNTIME_EXTERNAL_ACTIONS !== "false") blockers.push("external_actions_not_disabled");
  if (env.CEOAI_AGENT_RUNTIME_PAID_SERVICES !== "false") blockers.push("paid_services_not_disabled");
  if (!dependencies.invokeAgent || typeof dependencies.invokeAgent !== "function") blockers.push("agent_invoker_missing");
  if (!dependencies.reserveQuota || typeof dependencies.reserveQuota !== "function") blockers.push("atomic_quota_reserver_missing");
  if (!dependencies.validateResult || typeof dependencies.validateResult !== "function") blockers.push("result_validator_missing");
  if (dependencies.providerEligibility !== true) blockers.push("free_provider_eligibility_not_confirmed");
  if (dependencies.atomicQuota !== true) blockers.push("atomic_quota_not_confirmed");
  return Object.freeze({
    allowed: blockers.length === 0,
    blockers,
    mode: blockers.length === 0 ? "prerequisites-present" : "blocked",
    execution_started: false,
    external_actions_allowed: false,
    paid_services_allowed: false,
  });
}
