import test from "node:test";
import assert from "node:assert/strict";
import { createAgentHandoffPlan } from "../src/v5-modules/agent-handoff-planner.mjs";

const registry = {
  library_id: "handoff-planner-test",
  routing_policy: { default_max_skills_per_task: 4 },
  categories: [],
  skills: [],
};

test("creates deterministic coding handoff plan from Code Agent to QA Agent", () => {
  const plan = createAgentHandoffPlan(registry, "Popravi bug u Worker API", {
    taskId: "test-code-001",
    createdAt: "2026-10-29T12:00:00.000Z",
  });
  assert.equal(plan.mode, "handoff-plan-only");
  assert.equal(plan.task_type, "coding");
  assert.deepEqual(plan.agent_ids, ["coding-agent", "qa-agent"]);
  assert.equal(plan.handoffs.length, 1);
  assert.equal(plan.handoffs[0].from, "coding-agent");
  assert.equal(plan.handoffs[0].to, "qa-agent");
  assert.equal(plan.handoffs[0].task_id, "test-code-001");
});
test("creates SEO chain with only approved consecutive routes", () => {
  const plan = createAgentHandoffPlan(registry, "SEO audit sajta i meta opis", {
    taskId: "seo-task-01",
    createdAt: "2026-10-29T12:00:00.000Z",
  });
  assert.deepEqual(plan.agent_ids, ["content-seo-agent", "research-agent", "qa-agent"]);
  assert.deepEqual(plan.handoffs.map(h => [h.from, h.to]), [
    ["content-seo-agent", "research-agent"],
    ["research-agent", "qa-agent"],
  ]);
});
test("creates a chain with exactly one fewer handoff than agents", () => {
  for (const request of [
    "Popravi bug u API kodu",
    "Istraži dokumentaciju i izvore",
    "SEO audit sajta",
    "Napiši tekst za objavu",
    "Analiziraj rizike projekta",
    "Organizuj ovaj zadatak",
  ]) {
    const plan = createAgentHandoffPlan(registry, request, { taskId: "chain-test" });
    assert.equal(plan.handoffs.length, Math.max(0, plan.agent_ids.length - 1));
    assert.ok(plan.handoffs.length <= 3);
  }
});
test("every handoff preserves no-execution and no-paid-service policy", () => {
  const plan = createAgentHandoffPlan(registry, "Popravi bug u API kodu", { taskId: "policy-test" });
  assert.equal(plan.policy.execution_allowed, false);
  assert.equal(plan.policy.automatic_tool_execution_allowed, false);
  assert.equal(plan.policy.external_actions_allowed, false);
  assert.equal(plan.policy.paid_services_allowed, false);
  assert.equal(plan.policy.execution_started, false);
  for (const handoff of plan.handoffs) {
    assert.equal(handoff.policy.execution_allowed, false);
    assert.equal(handoff.policy.external_actions_allowed, false);
    assert.equal(handoff.policy.paid_services_allowed, false);
  }
});
test("rejects invalid task identifiers instead of creating unsafe handoff plans", () => {
  assert.throws(() => createAgentHandoffPlan(registry, "Popravi bug u API kodu", { taskId: "../secrets" }), TypeError);
});
test("rejects invalid request before planning a handoff", () => {
  assert.throws(() => createAgentHandoffPlan(registry, ""), TypeError);
  assert.throws(() => createAgentHandoffPlan(registry, "x".repeat(2001)), TypeError);
});
test("reports the runtime blocker accurately and does not claim agent execution", () => {
  const plan = createAgentHandoffPlan(registry, "Popravi bug u API kodu", { taskId: "blocked-runtime" });
  assert.equal(plan.block_reason, "handoff-plan-only-no-agent-runtime");
  assert.equal(plan.policy.execution_started, false);
  assert.equal(plan.handoffs.every(h => h.policy.mode === "handoff-envelope-only"), true);
});
