import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSkillAdmissionPipeline } from "../src/agent/skill-admission-pipeline.mjs";

const review = {
  sourcePinned: true, licenseVerified: true, hashVerified: true,
  dependenciesReviewed: true, scriptsReviewed: true, networkReviewed: true,
  credentialsReviewed: true
};
function fixture({ security = null, quality = { ok: true, qualityPassed: true, lifecycleStatus: "VERIFIED" }, refreshRegistry = null } = {}) {
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
    securityFirewall: { scan: async ({ contentSha256, bundleSha256 }) => { calls.push("firewall"); return security ?? { ok: true, status: "clean", contentSha256, bundleSha256 }; } },
    skillLifecycle: lifecycle,
    qualityEvaluator: { evaluate: async () => { calls.push("evaluator"); return quality; } },
    verifyIntakeReview: async () => { calls.push("verify-review"); return review; },
    refreshRegistry
  });
  return { pipeline, calls, records };
}
const request = {
  candidate: { id: "sample_skill", version: "1.0.0", description: "A sample skill candidate" }, content: "untrusted skill data", files: ["SKILL.md"],
  contentSha256: createHash("sha256").update("untrusted skill data").digest("hex"), bundleSha256: "b".repeat(64),
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


test("candidate content hash is recomputed before the Firewall and mismatches are rejected", async () => {
  const { pipeline, calls, records } = fixture();
  const result = await pipeline.admit({ ...request, contentSha256: "a".repeat(64) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANDIDATE_CONTENT_HASH_MISMATCH");
  assert.equal(records.get("sample_skill").status, "REJECTED");
  assert.equal(calls.includes("firewall"), false);
});

test("registry admission refuses to activate when the live registry cannot be refreshed", async () => {
  const { pipeline } = fixture();
  assert.equal((await pipeline.admit(request)).ok, true);
  const result = await pipeline.approveForRegistry("sample_skill", { approvedByOwner: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "REGISTRY_REFRESH_UNAVAILABLE");
});

test("owner approval refreshes the live runtime Skill Registry", async () => {
  let refreshed = 0;
  const { pipeline } = fixture({ refreshRegistry: async () => { refreshed++; } });
  assert.equal((await pipeline.admit(request)).ok, true);
  const result = await pipeline.approveForRegistry("sample_skill", { approvedByOwner: true });
  assert.equal(result.ok, true);
  assert.equal(result.registryRefreshed, true);
  assert.equal(result.selectable, true);
  assert.equal(refreshed, 1);
});


test("admission requires a valid bundle hash before lifecycle or scanner work", async () => {
  const { pipeline, calls } = fixture();
  const result = await pipeline.admit({ ...request, bundleSha256: "invalid" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_SKILL_ADMISSION_REQUEST");
  assert.deepEqual(calls, []);
});

test("admission quarantines scanner reports not bound to recomputed content and bundle hashes", async () => {
  const { pipeline, calls, records } = fixture({
    security: { ok: true, status: "clean", contentSha256: request.contentSha256, bundleSha256: "c".repeat(64) }
  });
  const result = await pipeline.admit(request);
  assert.equal(result.ok, false);
  assert.equal(result.code, "SECURITY_REPORT_BINDING_FAILED");
  assert.equal(result.isolated, true);
  assert.equal(records.get("sample_skill").status, "QUARANTINED");
  assert.equal(calls.includes("evaluator"), false);
});
