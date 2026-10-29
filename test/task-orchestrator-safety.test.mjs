import test from "node:test";
import assert from "node:assert/strict";
import { createTaskPlan } from "../src/v5-modules/task-orchestrator.mjs";

const emptyRegistry = {
  library_id: "test-only",
  routing_policy: { default_max_skills_per_task: 4 },
  categories: [],
  skills: [],
};

test("orchestrator classifies all supported task families and applies bounded agent handoffs", () => {
  const cases = [
    ["Popravi bug u JavaScript kodu", "coding", ["coding-agent", "qa-agent"]],
    ["Istraži izvore za ovu tvrdnju", "research", ["research-agent", "qa-agent"]],
    ["Uradi SEO audit sajta", "seo", ["content-seo-agent", "research-agent", "qa-agent"]],
    ["Napiši tekst za početnu stranicu", "writing", ["content-seo-agent", "qa-agent"]],
    ["Analiziraj rizike i predloži plan", "analysis", ["research-agent", "qa-agent"]],
    ["Pomozi mi oko zadatka", "general", ["research-agent", "qa-agent"]],
  ];

  for (const [request, expectedType, expectedAgents] of cases) {
    const plan = createTaskPlan(emptyRegistry, request);
    assert.equal(plan.task_type, expectedType, request);
    assert.deepEqual(plan.selected_agents.map(agent => agent.id), expectedAgents, request);
    assert.equal(plan.execution_allowed, false);
    assert.equal(plan.handoff_policy.agent_execution_enabled, false);
  }
});

test("agent and step limits are enforced and accurately reported", () => {
  const plan = createTaskPlan(emptyRegistry, "SEO audit sajta", { maxAgents: 1, maxSteps: 2 });
  assert.equal(plan.handoff_policy.max_agents, 1);
  assert.equal(plan.selected_agents.length, 1);
  assert.equal(plan.steps.length, 2);
  assert.throws(() => createTaskPlan(emptyRegistry, "SEO audit sajta", { maxAgents: -1 }), RangeError);
  assert.throws(() => createTaskPlan(emptyRegistry, "SEO audit sajta", { maxAgents: 1.5 }), RangeError);
  assert.throws(() => createTaskPlan(emptyRegistry, "SEO audit sajta", { maxSteps: 0 }), RangeError);
});

test("request validation rejects non-strings, blank strings, and oversized input", () => {
  for (const request of [null, undefined, 42, {}, "", "   ", "x".repeat(2001)]) {
    assert.throws(() => createTaskPlan(emptyRegistry, request), TypeError);
  }
});

test("agent plan is descriptive only and contains no raw request or secrets", () => {
  const secret = "sk-test-do-not-copy";
  const plan = createTaskPlan(emptyRegistry, `Analiziraj ovaj zahtev ${secret}`);
  const serialized = JSON.stringify(plan);
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.external_actions_allowed, false);
  assert.equal(plan.paid_services_allowed, false);
  assert.equal(plan.execution_policy.execution_started, false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("Analiziraj ovaj zahtev"), false);
});
