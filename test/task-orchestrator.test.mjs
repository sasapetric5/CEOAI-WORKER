import test from "node:test";
import assert from "node:assert/strict";
import { createTaskPlan } from "../src/v5-modules/task-orchestrator.mjs";
import { loadSkillRegistry } from "../src/v5-modules/skills-router.mjs";

test("orchestrator creates a bounded plan and never enables unreviewed skills", async () => {
  const registry = await loadSkillRegistry();
  const plan = createTaskPlan(registry, "Pregledaj SEO sajta i pronađi tehničke greške");
  assert.equal(plan.mode, "plan-only");
  assert.equal(plan.task_type, "seo");
  assert.deepEqual(plan.selected_agents.map(agent => agent.id), [
    "content-seo-agent", "research-agent", "qa-agent",
  ]);
  assert.equal(plan.handoff_policy.mode, "planned-only");
  assert.equal(plan.handoff_policy.agent_execution_enabled, false);
  assert.equal(plan.handoff_policy.external_actions_allowed, false);
  assert.equal(plan.handoff_policy.paid_services_allowed, false);
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.execution_block_reason, "plan-only-no-runtime-executor");
  assert.equal(plan.execution_policy.container_executor_available, false);
  assert.equal(plan.execution_policy.execution_started, false);
  assert.equal(plan.health_monitor.metrics_are_diagnostic_only, true);
  assert.equal(plan.health_monitor.raw_prompts_or_secrets_in_metrics, false);
  assert.equal(plan.health_monitor.health_status_grants_execution, false);
  assert.ok(plan.steps.some(step => step.id === "execute" && step.status === "blocked-plan-only-no-runtime"));
  assert.ok(plan.steps.filter(step => ["verify", "recover"].includes(step.id)).every(step => step.status === "blocked-until-runtime"));
  assert.ok(plan.blocked_skill_ids.includes("seo-audit"));
  assert.equal(plan.external_actions_allowed, false);
  assert.equal(plan.paid_services_allowed, false);
  assert.ok(plan.steps.length <= 6);
});

test("orchestrator rejects empty, oversized, and invalid plans", async () => {
  const registry = await loadSkillRegistry();
  assert.throws(() => createTaskPlan(registry, ""), TypeError);
  assert.throws(() => createTaskPlan(registry, "x".repeat(2001)), TypeError);
  assert.throws(() => createTaskPlan(registry, "SEO", { maxSteps: 7 }), RangeError);
  assert.throws(() => createTaskPlan(registry, "SEO", { maxAgents: 5 }), RangeError);
});

test("orchestrator permits execution only when the registry satisfies all gates", () => {
  const registry = {
    library_id: "ceoai-shared-skills",
    routing_policy: { default_max_skills_per_task: 4 },
    categories: [{ id: "seo", label: "SEO", tags: ["seo", "sajt"] }],
    skills: [{
      id: "seo-audit", name: "SEO audit", path: "skills/seo/SKILL.md",
      category: "seo", tags: ["seo", "sajt"], intents: [],
      runtime_status: "enabled", license_status: "approved",
      security_status: "verified", external_actions: false
    }]
  };
  const eligiblePlan = createTaskPlan(registry, "SEO audit sajta");
  assert.equal(eligiblePlan.skill_execution_eligible, true);
  assert.equal(eligiblePlan.execution_allowed, false);
  assert.equal(eligiblePlan.execution_policy.execution_started, false);
  registry.skills[0].external_actions = true;
  const blockedPlan = createTaskPlan(registry, "SEO audit sajta");
  assert.equal(blockedPlan.skill_execution_eligible, false);
  assert.equal(blockedPlan.execution_allowed, false);
});
