import test from "node:test";
import assert from "node:assert/strict";
import { createSkillAdmissionPipeline } from "../src/agent/skill-admission-pipeline.mjs";

const review = {
  sourcePinned: true, licenseVerified: true, hashVerified: true,
  dependenciesReviewed: true, scriptsReviewed: true, networkReviewed: true,
  credentialsReviewed: true
};
function fixture({ security = { ok: true }, quality = { ok: true, qualityPassed: true, lifecycleStatus: "VERIFIED" } = {}) {
  const calls = [];
  const records = new Map();
  const lifecycle = {
    async get(id) { return records.get(id) ?? null; },
    async discover({ id, metadata }) {
      calls.push("discover"); const record = { id, status: "DISCOVERED", metadata };
      records.set(id, record); return { ok: true, record };
    },
    async classifyCost(id, status) { calls.push("cost"); return { ok: true, record: records.get(id) }; },
    async recordSecurityReview(id, value) { calls.push("review"); return { ok: true, record: { ...records.get(id), securityReview: value } }; },
    async recordFailure(id, failure) {
      calls.push("isolate:" + failure.stage);
      const record = { ...records.get(id), status: failure.severity === "reject" ? "REJECTED" : "QUARANTINED", failure };
      records.set(id, record); return { ok: true, record };
    },
    async approveForActivation(id, options) {
      calls.push("activate");
      if (options.approvedByOwner !== true) return { ok: false, code: "EXPLICIT_OWNER_APPROVAL_REQUIRED" };
      const record = { ...records.get(id), status: "ACTIVE", ownerApproved: true }; records.set(id, record);
      return { ok: true, record };
    },
    isSelectable: record => record?.status === "ACTIVE" && record.ownerApproved === true
  };
  const pipeline = createSkillAdmissionPipeline({
    securityFirewall: { scan: async () => { calls.push("firewall"); return security; } },
    skillLifecycle: lifecycle,
    qualityEvaluator: { evaluate: async () => { calls.push("evaluator"); return quality; } },
    verifyIntakeReview: async () => { calls.push("verify-review"); return review; }
  });
  return { pipeline, calls, records };
}
const request = {
  candidate: { id: "sample_skill" }, content: "untrusted skill data", files: ["SKILL.md"],
  contentSha256: "a".repeat(64), bundleSha256: "b".repeat(64),
  reviewEvidence: { signed: true }, runId: "quality-run-0001",
  cases: [{ id: "case_one", input: {}, expectedOutput: "ok" }]
};

test("admission pipeline enforces firewall then evaluator and stops at VERIFIED", async () => {
  const { pipeline, calls } = fixture();
  const result = await pipeline.admit(request);
  assert.equal(result.ok, true);
  assert.equal(result.registryStatus, "VERIFIED");
  assert.equal(result.activation, "owner_approval_required");
  assert.deepEqual(calls, ["discover", "cost", "firewall", "verify-review", "review", "evaluator"]);
});

test("security failure quarantines and prevents evaluator or registry admission", async () => {
  const { pipeline, calls, records } = fixture({ security: { ok: false, code: "SECURITY_FINDINGS_REQUIRE_QUARANTINE", severity: "quarantine" } });
  const result = await pipeline.admit(request);
  assert.equal(result.ok, false);
  assert.equal(result.isolated, true);
  assert.equal(records.get("sample_skill").status, "QUARANTINED");
  assert.equal(calls.includes("evaluator"), false);
});

test("quality failure automatically quarantines after clean security review", async () => {
  const { pipeline, calls, records } = fixture({ quality: { ok: false, code: "QUALITY_GATE_FAILED" } });
  const result = await pipeline.admit(request);
  assert.equal(result.ok, false);
  assert.equal(result.isolated, true);
  assert.equal(records.get("sample_skill").status, "QUARANTINED");
  assert.equal(calls.at(-1), "isolate:quality");
});

test("verified candidate cannot activate without explicit owner approval", async () => {
  const { pipeline, calls } = fixture();
  assert.equal((await pipeline.admit(request)).ok, true);
  assert.equal((await pipeline.approveForRegistry("sample_skill")).code, "EXPLICIT_OWNER_APPROVAL_REQUIRED");
  assert.equal(calls.includes("activate"), true);
});

test("missing intake evidence fails closed before quality evaluation", async () => {
  const { pipeline, calls } = fixture();
  const invalid = { ...request, reviewEvidence: null };
  const result = await pipeline.admit(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.isolated, true);
  assert.equal(calls.includes("evaluator"), false);
});
