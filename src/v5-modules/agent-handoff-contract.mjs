// CEOAI V5.0 — bounded, metadata-only agent handoff contract.
// This creates and validates handoff envelopes; it does not call agents or execute tools.
const MAX_PAYLOAD_CHARS = 4000;
const MAX_SUMMARY_CHARS = 2000;
const MAX_ARTIFACTS = 10;
const MAX_ARTIFACT_CHARS = 2000;
const AGENT_IDS = new Set([
  "ceoai-orchestrator",
  "coding-agent",
  "research-agent",
  "qa-agent",
  "content-seo-agent",
]);
const HANDOFFS = new Map([
  ["coding-agent", new Set(["qa-agent"])],
  ["research-agent", new Set(["qa-agent"])],
  ["content-seo-agent", new Set(["research-agent", "qa-agent"])],
  ["ceoai-orchestrator", new Set(["coding-agent", "research-agent", "qa-agent", "content-seo-agent"])],
]);

const SECRET_LIKE = /(?:\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+)/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value, max, field) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError(field + " must be a non-empty string up to " + max + " characters");
  }
  if (SECRET_LIKE.test(value)) throw new TypeError(field + " appears to contain a secret");
  return value.trim();
}

export function createAgentHandoff(input) {
  if (!isPlainObject(input)) throw new TypeError("handoff input must be an object");
  const from = input.from;
  const to = input.to;
  if (!AGENT_IDS.has(from) || !AGENT_IDS.has(to)) throw new TypeError("unknown agent id");
  if (from === to) throw new TypeError("self-handoff is forbidden");
  if (!HANDOFFS.get(from)?.has(to)) throw new TypeError("handoff route is not approved");
  const taskId = input.task_id;
  if (typeof taskId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(taskId)) {
    throw new TypeError("task_id must be a safe identifier up to 64 characters");
  }
  const payload = boundedText(input.payload, MAX_PAYLOAD_CHARS, "payload");
  const createdAt = input.created_at ?? new Date().toISOString();
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) {
    throw new TypeError("created_at must be a valid timestamp string");
  }
  return {
    schema_version: "1.0.0",
    task_id: taskId,
    from,
    to,
    payload,
    created_at: new Date(createdAt).toISOString(),
    policy: {
      mode: "handoff-envelope-only",
      execution_allowed: false,
      external_actions_allowed: false,
      paid_services_allowed: false,
      secrets_included: false,
      owner_approval_required_for_mutations: true,
    },
  };
}

export function validateAgentResult(result, expected = {}) {
  const reasons = [];
  if (!isPlainObject(result)) return { valid: false, reasons: ["result-must-be-object"], execution_started: false };
  if (typeof expected.task_id === "string" && result.task_id !== expected.task_id) reasons.push("task-id-mismatch");
  if (typeof expected.agent_id === "string" && result.agent_id !== expected.agent_id) reasons.push("agent-id-mismatch");
  if (!AGENT_IDS.has(result.agent_id)) reasons.push("unknown-agent-id");
  if (!["completed", "partial", "blocked", "failed"].includes(result.status)) reasons.push("invalid-status");
  if (typeof result.summary !== "string" || !result.summary.trim() || result.summary.length > MAX_SUMMARY_CHARS) {
    reasons.push("invalid-summary");
  } else if (SECRET_LIKE.test(result.summary)) {
    reasons.push("possible-secret-in-summary");
  }
  if (result.artifacts !== undefined) {
    if (!Array.isArray(result.artifacts) || result.artifacts.length > MAX_ARTIFACTS) reasons.push("invalid-artifacts");
    else for (const artifact of result.artifacts) {
      if (typeof artifact !== "string" || !artifact.trim() || artifact.length > MAX_ARTIFACT_CHARS) {
        reasons.push("invalid-artifact");
        break;
      }
      if (SECRET_LIKE.test(artifact)) {
        reasons.push("possible-secret-in-artifact");
        break;
      }
    }
  }
  if (result.external_actions_performed !== false) reasons.push("external-actions-must-be-false");
  if (result.paid_services_used !== false) reasons.push("paid-services-must-be-false");
  if (result.execution_started !== false) reasons.push("execution-claim-not-permitted");
  return { valid: reasons.length === 0, reasons, execution_started: false };
}

export const AGENT_HANDOFF_LIMITS = Object.freeze({
  max_payload_chars: MAX_PAYLOAD_CHARS,
  max_summary_chars: MAX_SUMMARY_CHARS,
  max_artifacts: MAX_ARTIFACTS,
  max_artifact_chars: MAX_ARTIFACT_CHARS,
  execution_enabled: false,
  external_actions_enabled: false,
  paid_services_enabled: false,
});
