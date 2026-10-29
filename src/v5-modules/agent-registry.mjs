// CEOAI V5.0 — lightweight, metadata-only agent registry.
// Deliberately framework-free: no new runtime, paid service, or automatic external actions.
// This registry plans handoffs only. It never executes agents or grants tool permissions.

const DEFINITIONS = Object.freeze([
  {
    id: "ceoai-orchestrator",
    name: "CEOAI Orchestrator",
    role: "supervisor",
    taskTypes: ["coding", "research", "seo", "writing", "analysis", "general"],
    purpose: "Classify the request, choose bounded specialist handoffs, and report evidence.",
    runtimeStatus: "built-in-planning-only",
    externalActions: false,
    paidServices: false,
  },
  {
    id: "research-agent",
    name: "Research Agent",
    role: "specialist",
    taskTypes: ["research", "analysis", "seo", "general"],
    purpose: "Organize sources, evidence, uncertainty, and findings.",
    runtimeStatus: "plan-only",
    externalActions: false,
    paidServices: false,
  },
  {
    id: "coding-agent",
    name: "Coding Agent",
    role: "specialist",
    taskTypes: ["coding"],
    purpose: "Review code and prepare bounded implementation proposals.",
    runtimeStatus: "plan-only",
    externalActions: false,
    paidServices: false,
    ownerApprovalRequiredForMutations: true,
  },
  {
    id: "qa-agent",
    name: "QA / Test Agent",
    role: "specialist",
    taskTypes: ["coding", "research", "seo", "writing", "analysis", "general"],
    purpose: "Define checks and validate results only when a permitted test runtime exists.",
    runtimeStatus: "plan-only",
    externalActions: false,
    paidServices: false,
  },
  {
    id: "content-seo-agent",
    name: "Content & SEO Agent",
    role: "specialist",
    taskTypes: ["seo", "writing"],
    purpose: "Plan content-quality, on-page SEO, and structured-data reviews.",
    runtimeStatus: "plan-only",
    externalActions: false,
    paidServices: false,
    ownerApprovalRequiredForPublishing: true,
  },
]);

const TASK_TYPES = new Set(["coding", "research", "seo", "writing", "analysis", "general"]);
const DEFAULT_MAX_AGENTS = 4;

const TASK_AGENT_ORDER = Object.freeze({
  coding: ["coding-agent", "qa-agent"],
  research: ["research-agent", "qa-agent"],
  seo: ["content-seo-agent", "research-agent", "qa-agent"],
  writing: ["content-seo-agent", "qa-agent"],
  analysis: ["research-agent", "qa-agent"],
  general: ["research-agent", "qa-agent"],
});

export function listAgents() {
  return DEFINITIONS.map(agent => ({
    ...agent,
    taskTypes: [...agent.taskTypes],
  }));
}

export function getAgent(agentId) {
  const agent = DEFINITIONS.find(item => item.id === agentId);
  return agent ? { ...agent, taskTypes: [...agent.taskTypes] } : null;
}

export function selectTaskAgents(taskType, options = {}) {
  if (!TASK_TYPES.has(taskType)) {
    throw new TypeError("Unsupported task type");
  }
  const maxAgents = options.maxAgents ?? DEFAULT_MAX_AGENTS;
  if (!Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > DEFAULT_MAX_AGENTS) {
    throw new RangeError("maxAgents must be an integer between 1 and 4");
  }
  const byId = new Map(DEFINITIONS.map(agent => [agent.id, agent]));
  const selected = (TASK_AGENT_ORDER[taskType] ?? TASK_AGENT_ORDER.general)
    .slice(0, maxAgents)
    .map(id => byId.get(id))
    .filter(Boolean);
  return selected.map(agent => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    purpose: agent.purpose,
    runtime_status: agent.runtimeStatus,
    task_types: [...agent.taskTypes],
    execution_allowed: false,
    external_actions_allowed: false,
    paid_services_allowed: false,
    owner_approval_required_for_mutations: agent.ownerApprovalRequiredForMutations === true,
    owner_approval_required_for_publishing: agent.ownerApprovalRequiredForPublishing === true,
  }));
}

export const AGENT_REGISTRY_POLICY = Object.freeze({
  mode: "metadata-only",
  default_max_agents_per_task: DEFAULT_MAX_AGENTS,
  execution_enabled: false,
  external_actions_enabled: false,
  paid_services_enabled: false,
  require_owner_approval_for_code_mutations: true,
  require_owner_approval_for_publishing: true,
});
