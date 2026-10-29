import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_REGISTRY_POLICY,
  getAgent,
  listAgents,
  selectTaskAgents,
} from "../src/v5-modules/agent-registry.mjs";

test("agent registry exposes the five planned roles without enabling execution", () => {
  const agents = listAgents();
  assert.deepEqual(agents.map(agent => agent.id), [
    "ceoai-orchestrator",
    "research-agent",
    "coding-agent",
    "qa-agent",
    "content-seo-agent",
  ]);
  assert.equal(AGENT_REGISTRY_POLICY.execution_enabled, false);
  assert.equal(AGENT_REGISTRY_POLICY.external_actions_enabled, false);
  assert.equal(AGENT_REGISTRY_POLICY.paid_services_enabled, false);
  assert.ok(agents.every(agent => agent.externalActions === false && agent.paidServices === false));
});

test("task routing returns deterministic, bounded specialist handoffs", () => {
  assert.deepEqual(selectTaskAgents("coding").map(agent => agent.id), ["coding-agent", "qa-agent"]);
  assert.deepEqual(selectTaskAgents("seo").map(agent => agent.id), [
    "content-seo-agent", "research-agent", "qa-agent",
  ]);
  assert.deepEqual(selectTaskAgents("research", { maxAgents: 1 }).map(agent => agent.id), ["research-agent"]);
  assert.deepEqual(selectTaskAgents("general"), selectTaskAgents("general"));
});

test("selected agents are plans only and cannot perform external actions", () => {
  for (const taskType of ["coding", "research", "seo", "writing", "analysis", "general"]) {
    const selected = selectTaskAgents(taskType);
    assert.ok(selected.length >= 1 && selected.length <= 4);
    assert.ok(selected.every(agent => agent.execution_allowed === false));
    assert.ok(selected.every(agent => agent.external_actions_allowed === false));
    assert.ok(selected.every(agent => agent.paid_services_allowed === false));
    assert.ok(selected.every(agent => agent.runtime_status === "plan-only"));
  }
  assert.equal(getAgent("coding-agent").ownerApprovalRequiredForMutations, true);
  assert.equal(getAgent("content-seo-agent").ownerApprovalRequiredForPublishing, true);
  assert.equal(getAgent("unknown-agent"), null);
});

test("agent routing rejects invalid task types and unsafe limits", () => {
  assert.throws(() => selectTaskAgents("unknown"), TypeError);
  assert.throws(() => selectTaskAgents("coding", { maxAgents: 0 }), RangeError);
  assert.throws(() => selectTaskAgents("coding", { maxAgents: 5 }), RangeError);
});
