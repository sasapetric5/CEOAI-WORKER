import test from "node:test";
import assert from "node:assert/strict";
import { createTaskPlan } from "../src/v5-modules/task-orchestrator.mjs";
import { listAgents, getAgent, selectTaskAgents, AGENT_REGISTRY_POLICY } from "../src/v5-modules/agent-registry.mjs";

const skillRegistry = { library_id: "agent-test", routing_policy: { default_max_skills_per_task: 4 }, categories: [], skills: [] };

const CASES = [
  { prompt: "Popravi grešku u Worker API kodu", type: "coding", agents: ["coding-agent", "qa-agent"] },
  { prompt: "Istraži dokumentaciju i izvore", type: "research", agents: ["research-agent", "qa-agent"] },
  { prompt: "SEO audit sajta i meta opis", type: "seo", agents: ["content-seo-agent", "research-agent", "qa-agent"] },
  { prompt: "Napiši tekst za objavu", type: "writing", agents: ["content-seo-agent", "qa-agent"] },
  { prompt: "Analiziraj rizike projekta", type: "analysis", agents: ["research-agent", "qa-agent"] },
  { prompt: "Pomozi mi oko organizacije zadatka", type: "general", agents: ["research-agent", "qa-agent"] },
];

test("registry exposes unique agent IDs", () => {
  const agents = listAgents();
  assert.equal(new Set(agents.map(a => a.id)).size, agents.length);
});
test("registry contains supervisor and all three first-turn specialists", () => {
  const ids = new Set(listAgents().map(a => a.id));
  for (const id of ["ceoai-orchestrator", "coding-agent", "research-agent", "qa-agent"]) assert.ok(ids.has(id));
});
test("all registered agents default to non-executable plan-only status", () => {
  for (const agent of listAgents()) {
    assert.ok(["built-in-planning-only", "plan-only"].includes(agent.runtimeStatus));
    assert.equal(agent.externalActions, false);
    assert.equal(agent.paidServices, false);
  }
});
test("registry policy keeps execution, external actions and paid services disabled", () => {
  assert.equal(AGENT_REGISTRY_POLICY.execution_enabled, false);
  assert.equal(AGENT_REGISTRY_POLICY.external_actions_enabled, false);
  assert.equal(AGENT_REGISTRY_POLICY.paid_services_enabled, false);
});
test("getAgent returns a copy, not mutable registry-owned task types", () => {
  const agent = getAgent("coding-agent");
  agent.taskTypes.push("shell");
  assert.equal(getAgent("coding-agent").taskTypes.includes("shell"), false);
});
test("listAgents returns defensive copies", () => {
  const agents = listAgents();
  agents[0].taskTypes.push("shell");
  assert.equal(listAgents()[0].taskTypes.includes("shell"), false);
});
test("unknown agent lookup returns null", () => {
  assert.equal(getAgent("unknown-agent"), null);
});
test("unsupported task types are rejected", () => {
  for (const type of ["", "shell", "deployment", null, undefined, {}, 1]) assert.throws(() => selectTaskAgents(type), TypeError);
});
test("agent count limit rejects unsafe values", () => {
  for (const maxAgents of [-1, 0, 1.5, 5, NaN, Infinity, "2"]) assert.throws(() => selectTaskAgents("coding", { maxAgents }), RangeError);
});
test("agent selection honors a one-agent cap", () => {
  assert.deepEqual(selectTaskAgents("coding", { maxAgents: 1 }).map(a => a.id), ["coding-agent"]);
});
test("agent selection honors a two-agent cap", () => {
  assert.deepEqual(selectTaskAgents("coding", { maxAgents: 2 }).map(a => a.id), ["coding-agent", "qa-agent"]);
});
test("every selected agent explicitly denies execution", () => {
  for (const {type} of CASES) for (const a of selectTaskAgents(type)) assert.equal(a.execution_allowed, false);
});
test("every selected agent denies external actions and paid services", () => {
  for (const {type} of CASES) for (const a of selectTaskAgents(type)) {
    assert.equal(a.external_actions_allowed, false);
    assert.equal(a.paid_services_allowed, false);
  }
});
test("all six supported task families produce their expected handoff plan", () => {
  for (const c of CASES) {
    const plan = createTaskPlan(skillRegistry, c.prompt);
    assert.equal(plan.task_type, c.type);
    assert.deepEqual(plan.selected_agents.map(a => a.id), c.agents);
  }
});
test("coding plan pairs coding specialist with QA", () => {
  const plan = createTaskPlan(skillRegistry, CASES[0].prompt);
  assert.deepEqual(plan.selected_agents.map(a => a.id), ["coding-agent", "qa-agent"]);
});
test("research plan pairs research specialist with QA", () => {
  const plan = createTaskPlan(skillRegistry, CASES[1].prompt);
  assert.deepEqual(plan.selected_agents.map(a => a.id), ["research-agent", "qa-agent"]);
});
test("SEO plan includes content, research and QA in deterministic order", () => {
  const plan = createTaskPlan(skillRegistry, CASES[2].prompt);
  assert.deepEqual(plan.selected_agents.map(a => a.id), ["content-seo-agent", "research-agent", "qa-agent"]);
});
test("all plans explicitly state execution has not started", () => {
  for (const c of CASES) assert.equal(createTaskPlan(skillRegistry, c.prompt).execution_policy.execution_started, false);
});
test("health status cannot authorize agent execution", () => {
  for (const c of CASES) assert.equal(createTaskPlan(skillRegistry, c.prompt).health_monitor.health_status_grants_execution, false);
});
test("plan-only task results contain request length but not raw request text", () => {
  const secretMarker = "SENSITIVE-TEST-MARKER-DO-NOT-LEAK";
  const plan = createTaskPlan(skillRegistry, "Analiziraj " + secretMarker);
  assert.equal(JSON.stringify(plan).includes(secretMarker), false);
});
test("task planner rejects empty prompts", () => {
  for (const prompt of ["", " ", "\n\t"]) assert.throws(() => createTaskPlan(skillRegistry, prompt), TypeError);
});
test("task planner rejects non-string prompts", () => {
  for (const prompt of [null, undefined, 0, false, {}, []]) assert.throws(() => createTaskPlan(skillRegistry, prompt), TypeError);
});
test("task planner rejects oversized prompts", () => {
  assert.throws(() => createTaskPlan(skillRegistry, "x".repeat(2001)), TypeError);
});
test("task planner rejects an excessive agent budget", () => {
  assert.throws(() => createTaskPlan(skillRegistry, "Analiziraj projekat", { maxAgents: 5 }), RangeError);
});
test("repeated planning yields deterministic agent order", () => {
  for (const c of CASES) {
    const first = createTaskPlan(skillRegistry, c.prompt);
    const second = createTaskPlan(skillRegistry, c.prompt);
    assert.deepEqual(first.selected_agents.map(a => a.id), second.selected_agents.map(a => a.id));
  }
});
