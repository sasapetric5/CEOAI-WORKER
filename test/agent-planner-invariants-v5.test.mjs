import test from "node:test";
import assert from "node:assert/strict";
import { createTaskPlan } from "../src/v5-modules/task-orchestrator.mjs";

const registry = {
  library_id: "agent-hardening-tests",
  routing_policy: { default_max_skills_per_task: 4 },
  categories: [],
  skills: [],
};

const prompts = [
  ["Popravi grešku u Worker API kodu", "coding", ["coding-agent", "qa-agent"]],
  ["Istraži dokumentaciju i izvore", "research", ["research-agent", "qa-agent"]],
  ["SEO audit sajta i meta opis", "seo", ["content-seo-agent", "research-agent", "qa-agent"]],
  ["Napiši tekst za objavu", "writing", ["content-seo-agent", "qa-agent"]],
  ["Analiziraj rizike projekta", "analysis", ["research-agent", "qa-agent"]],
  ["Pomozi mi oko organizacije zadatka", "general", ["research-agent", "qa-agent"]],
];

test("task planner consistently routes every supported task family", () => {
  for (const [prompt, type, agents] of prompts) {
    const plan = createTaskPlan(registry, prompt);
    assert.equal(plan.task_type, type);
    assert.deepEqual(plan.selected_agents.map(agent => agent.id), agents);
  }
});

test("all planned agents explicitly deny execution and external actions", () => {
  for (const [prompt] of prompts) {
    const plan = createTaskPlan(registry, prompt);
    assert.ok(plan.selected_agents.length <= 4);
    for (const agent of plan.selected_agents) {
      assert.equal(agent.execution_allowed, false);
      assert.equal(agent.external_actions_allowed, false);
      assert.equal(agent.paid_services_allowed, false);
    }
  }
});

test("all task plans are plan-only and cannot claim task execution", () => {
  for (const [prompt] of prompts) {
    const plan = createTaskPlan(registry, prompt);
    assert.equal(plan.mode, "plan-only");
    assert.equal(plan.execution_allowed, false);
    assert.equal(plan.handoff_policy.agent_execution_enabled, false);
    assert.equal(plan.handoff_policy.automatic_tool_execution_enabled, false);
    assert.equal(plan.execution_policy.execution_started, false);
  }
});

test("all plans require owner approval for external actions", () => {
  for (const [prompt] of prompts) {
    const plan = createTaskPlan(registry, prompt);
    assert.equal(plan.requires_owner_approval_for_external_actions, true);
    assert.equal(plan.external_actions_allowed, false);
    assert.equal(plan.paid_services_allowed, false);
  }
});

test("plans remain bounded to six steps and four agents", () => {
  for (const [prompt] of prompts) {
    const plan = createTaskPlan(registry, prompt);
    assert.ok(plan.steps.length <= 6);
    assert.ok(plan.selected_agents.length <= 4);
  }
});

test("planner rejects unknown step budget types and unsafe limits", () => {
  for (const maxSteps of [-1, 0, 1.5, 7, NaN, Infinity, "3"]) {
    assert.throws(() => createTaskPlan(registry, "Analiziraj projekat", { maxSteps }), RangeError);
  }
});

test("planner rejects unknown agent budget types and unsafe limits", () => {
  for (const maxAgents of [-1, 0, 1.5, 5, NaN, Infinity, "2"]) {
    assert.throws(() => createTaskPlan(registry, "Analiziraj projekat", { maxAgents }), RangeError);
  }
});

test("planner rejects empty and whitespace-only prompts", () => {
  for (const prompt of ["", " ", "\n\t", "   \n  "]) {
    assert.throws(() => createTaskPlan(registry, prompt), TypeError);
  }
});

test("planner rejects non-string prompts", () => {
  for (const prompt of [null, undefined, 0, 1, true, {}, [], new String("test")]) {
    assert.throws(() => createTaskPlan(registry, prompt), TypeError);
  }
});

test("planner rejects requests beyond the documented size limit", () => {
  assert.throws(() => createTaskPlan(registry, "x".repeat(2001)), TypeError);
});

test("planner accepts request exactly at the documented size limit", () => {
  const plan = createTaskPlan(registry, "x".repeat(2000));
  assert.equal(plan.request_chars, 2000);
  assert.equal(plan.execution_allowed, false);
});

test("plan exposes only bounded request metadata rather than raw prompt", () => {
  const marker = "private-user-content-marker";
  const plan = createTaskPlan(registry, "Analiziraj " + marker);
  assert.equal(plan.request_chars, ("Analiziraj " + marker).length);
  assert.equal(JSON.stringify(plan).includes(marker), false);
});

test("health diagnostics cannot authorize agent execution", () => {
  const plan = createTaskPlan(registry, "Istraži izvore");
  assert.equal(plan.health_monitor.health_status_grants_execution, false);
  assert.equal(plan.execution_allowed, false);
});

test("container execution remains disabled in every plan", () => {
  const plan = createTaskPlan(registry, "Popravi testove");
  assert.equal(plan.execution_policy.container_executor_available, false);
  assert.equal(plan.execution_policy.execution_started, false);
});

test("execution step is clearly blocked in plan-only mode", () => {
  const plan = createTaskPlan(registry, "Popravi testove");
  const execute = plan.steps.find(step => step.id === "execute");
  assert.equal(execute.status, "blocked-plan-only-no-runtime");
});

test("verification and recovery steps cannot claim to have run", () => {
  const plan = createTaskPlan(registry, "Popravi testove");
  assert.equal(plan.steps.find(step => step.id === "verify").status, "blocked-until-runtime");
  assert.equal(plan.steps.find(step => step.id === "recover").status, "blocked-until-runtime");
});

test("selected agents do not imply that a skill is executable", () => {
  const plan = createTaskPlan(registry, "SEO audit sajta");
  assert.equal(plan.selected_agents.length > 0, true);
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.skill_execution_eligible, false);
});

test("plan records a stable schema version", () => {
  const plan = createTaskPlan(registry, "Analiziraj projekat");
  assert.equal(plan.schema_version, "1.0.0");
});

test("plan preserves deterministic agent order across repeated calls", () => {
  for (const [prompt] of prompts) {
    const first = createTaskPlan(registry, prompt);
    const second = createTaskPlan(registry, prompt);
    assert.deepEqual(first.selected_agents.map(a => a.id), second.selected_agents.map(a => a.id));
  }
});

test("plan does not grant mutation or publishing approval implicitly", () => {
  const plan = createTaskPlan(registry, "Popravi kod i objavi izmene");
  assert.equal(plan.execution_allowed, false);
  assert.ok(plan.selected_agents.every(agent => agent.external_actions_allowed === false));
  assert.equal(plan.external_actions_allowed, false);
});
