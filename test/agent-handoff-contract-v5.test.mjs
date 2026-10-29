import test from "node:test";
import assert from "node:assert/strict";
import {
  createAgentHandoff,
  createValidatedNextHandoff,
  validateAgentResult,
  AGENT_HANDOFF_LIMITS,
} from "../src/v5-modules/agent-handoff-contract.mjs";

const base = {
  task_id: "ceoai-task-42",
  from: "coding-agent",
  to: "qa-agent",
  payload: "Proveri predlog izmena i prijavi regresije.",
  created_at: "2026-10-29T12:00:00.000Z",
};

test("creates a bounded Code Agent to QA Agent handoff envelope", () => {
  const handoff = createAgentHandoff(base);
  assert.equal(handoff.schema_version, "1.0.0");
  assert.equal(handoff.from, "coding-agent");
  assert.equal(handoff.to, "qa-agent");
  assert.equal(handoff.task_id, base.task_id);
  assert.equal(handoff.policy.execution_allowed, false);
  assert.equal(handoff.policy.external_actions_allowed, false);
  assert.equal(handoff.policy.paid_services_allowed, false);
  assert.equal(handoff.policy.secrets_included, false);
});
test("allows approved orchestrator specialist routes", () => {
  assert.equal(createAgentHandoff({ ...base, from: "ceoai-orchestrator", to: "coding-agent" }).to, "coding-agent");
  assert.equal(createAgentHandoff({ ...base, from: "content-seo-agent", to: "research-agent" }).to, "research-agent");
});
test("rejects unknown agent identities", () => {
  assert.throws(() => createAgentHandoff({ ...base, from: "shell-agent" }), TypeError);
  assert.throws(() => createAgentHandoff({ ...base, to: "unknown-agent" }), TypeError);
});
test("rejects unapproved handoff routes", () => {
  assert.throws(() => createAgentHandoff({ ...base, from: "coding-agent", to: "research-agent" }), /route is not approved/);
});
test("rejects self-handoff", () => {
  assert.throws(() => createAgentHandoff({ ...base, from: "qa-agent", to: "qa-agent" }), /self-handoff/);
});
test("rejects malformed task identifiers", () => {
  for (const task_id of ["", "../secrets", "has spaces", "x".repeat(65), null]) {
    assert.throws(() => createAgentHandoff({ ...base, task_id }), TypeError);
  }
});
test("rejects empty and oversized payloads", () => {
  for (const payload of ["", "  ", "x".repeat(4001), null]) {
    assert.throws(() => createAgentHandoff({ ...base, payload }), TypeError);
  }
});
test("rejects common API key and credential patterns in handoff payload", () => {
  for (const payload of [
    "api_key=abc123",
    "access_token: xyz",
    "password=hunter2",
    "sk-12345678901234567890",
    "-----BEGIN PRIVATE KEY-----",
  ]) assert.throws(() => createAgentHandoff({ ...base, payload }), /secret/);
});
test("rejects invalid timestamps", () => {
  assert.throws(() => createAgentHandoff({ ...base, created_at: "not-a-date" }), TypeError);
});
test("normalizes timestamps to ISO format", () => {
  assert.equal(createAgentHandoff({ ...base, created_at: "2026-10-29T12:00:00Z" }).created_at, "2026-10-29T12:00:00.000Z");
});
test("uses a generated timestamp when none is supplied", () => {
  const handoff = createAgentHandoff({ ...base, created_at: undefined });
  assert.ok(Number.isFinite(Date.parse(handoff.created_at)));
});
test("rejects non-object handoff input", () => {
  for (const input of [null, [], "hello", 1]) assert.throws(() => createAgentHandoff(input), TypeError);
});
test("validates a successful QA result with matching task and agent", () => {
  const result = {
    task_id: base.task_id,
    agent_id: "qa-agent",
    status: "completed",
    summary: "Provere su prošle; nema pronađenih regresija u zadatom obimu.",
    artifacts: ["test-report.txt"],
    external_actions_performed: false,
    paid_services_used: false,
    execution_started: false,
  };
  assert.deepEqual(validateAgentResult(result, { task_id: base.task_id, agent_id: "qa-agent" }), {
    valid: true, reasons: [], execution_started: false,
  });
});
test("rejects result from the wrong task or agent", () => {
  const result = {
    task_id: "other-task", agent_id: "coding-agent", status: "completed", summary: "Done",
    external_actions_performed: false, paid_services_used: false, execution_started: false,
  };
  const validation = validateAgentResult(result, { task_id: base.task_id, agent_id: "qa-agent" });
  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes("task-id-mismatch"));
  assert.ok(validation.reasons.includes("agent-id-mismatch"));
});
test("rejects result that claims external actions or paid service use", () => {
  const result = {
    task_id: base.task_id, agent_id: "qa-agent", status: "completed", summary: "Done",
    external_actions_performed: true, paid_services_used: true, execution_started: false,
  };
  const validation = validateAgentResult(result);
  assert.ok(validation.reasons.includes("external-actions-must-be-false"));
  assert.ok(validation.reasons.includes("paid-services-must-be-false"));
});
test("rejects a result claiming runtime execution", () => {
  const result = {
    task_id: base.task_id, agent_id: "qa-agent", status: "completed", summary: "Done",
    external_actions_performed: false, paid_services_used: false, execution_started: true,
  };
  assert.ok(validateAgentResult(result).reasons.includes("execution-claim-not-permitted"));
});
test("rejects invalid result status and empty summary", () => {
  for (const patch of [{ status: "success" }, { summary: " " }, { summary: "x".repeat(2001) }]) {
    const result = {
      task_id: base.task_id, agent_id: "qa-agent", status: "completed", summary: "Done",
      external_actions_performed: false, paid_services_used: false, execution_started: false,
      ...patch,
    };
    assert.equal(validateAgentResult(result).valid, false);
  }
});
test("rejects secret-like content in result summary and artifacts", () => {
  const common = {
    task_id: base.task_id, agent_id: "qa-agent", status: "completed", summary: "Done",
    external_actions_performed: false, paid_services_used: false, execution_started: false,
  };
  assert.ok(validateAgentResult({ ...common, summary: "api_key=abc123" }).reasons.includes("possible-secret-in-summary"));
  assert.ok(validateAgentResult({ ...common, artifacts: ["access_token=abc"] }).reasons.includes("possible-secret-in-artifact"));
});
test("caps artifact count and artifact length", () => {
  const common = {
    task_id: base.task_id, agent_id: "qa-agent", status: "completed", summary: "Done",
    external_actions_performed: false, paid_services_used: false, execution_started: false,
  };
  assert.ok(validateAgentResult({ ...common, artifacts: Array(11).fill("report") }).reasons.includes("invalid-artifacts"));
  assert.ok(validateAgentResult({ ...common, artifacts: ["x".repeat(2001)] }).reasons.includes("invalid-artifact"));
});
test("rejects malformed results and malformed artifact collections", () => {
  assert.deepEqual(validateAgentResult(null), { valid: false, reasons: ["result-must-be-object"], execution_started: false });
  const common = {
    task_id: base.task_id, agent_id: "qa-agent", status: "completed", summary: "Done",
    external_actions_performed: false, paid_services_used: false, execution_started: false,
  };
  assert.ok(validateAgentResult({ ...common, artifacts: "report" }).reasons.includes("invalid-artifacts"));
});
test("documents hard limits and disabled runtime capabilities", () => {
  assert.equal(AGENT_HANDOFF_LIMITS.max_payload_chars, 4000);
  assert.equal(AGENT_HANDOFF_LIMITS.max_summary_chars, 2000);
  assert.equal(AGENT_HANDOFF_LIMITS.max_artifacts, 10);
  assert.equal(AGENT_HANDOFF_LIMITS.execution_enabled, false);
  assert.equal(AGENT_HANDOFF_LIMITS.external_actions_enabled, false);
  assert.equal(AGENT_HANDOFF_LIMITS.paid_services_enabled, false);
});

test("validated Code Agent result may be handed to QA Agent", () => {
  const result = {
    task_id: base.task_id, agent_id: "coding-agent", status: "completed",
    summary: "Predlog izmene je spreman za nezavisnu proveru.",
    artifacts: ["patch-review.txt"],
    external_actions_performed: false, paid_services_used: false, execution_started: false,
  };
  const transition = createValidatedNextHandoff({
    task_id: base.task_id, expected_agent_id: "coding-agent", next_agent_id: "qa-agent", result,
    created_at: "2026-10-29T12:00:00.000Z",
  });
  assert.equal(transition.allowed, true);
  assert.deepEqual(transition.reasons, []);
  assert.equal(transition.handoff.from, "coding-agent");
  assert.equal(transition.handoff.to, "qa-agent");
  assert.equal(transition.execution_started, false);
});
test("invalid or mismatched prior result blocks handoff", () => {
  const result = {
    task_id: "wrong-task", agent_id: "coding-agent", status: "completed", summary: "Patch ready",
    external_actions_performed: false, paid_services_used: false, execution_started: false,
  };
  const transition = createValidatedNextHandoff({
    task_id: base.task_id, expected_agent_id: "coding-agent", next_agent_id: "qa-agent", result,
  });
  assert.equal(transition.allowed, false);
  assert.equal(transition.handoff, null);
  assert.ok(transition.reasons.includes("task-id-mismatch"));
});
test("result claiming paid service or external action cannot be handed off", () => {
  const result = {
    task_id: base.task_id, agent_id: "coding-agent", status: "completed", summary: "Patch ready",
    external_actions_performed: true, paid_services_used: false, execution_started: false,
  };
  const transition = createValidatedNextHandoff({
    task_id: base.task_id, expected_agent_id: "coding-agent", next_agent_id: "qa-agent", result,
  });
  assert.equal(transition.allowed, false);
  assert.ok(transition.reasons.includes("external-actions-must-be-false"));
});
test("transition blocks unapproved next-agent route", () => {
  const result = {
    task_id: base.task_id, agent_id: "coding-agent", status: "completed", summary: "Patch ready",
    external_actions_performed: false, paid_services_used: false, execution_started: false,
  };
  const transition = createValidatedNextHandoff({
    task_id: base.task_id, expected_agent_id: "coding-agent", next_agent_id: "research-agent", result,
  });
  assert.equal(transition.allowed, false);
  assert.equal(transition.handoff, null);
});
