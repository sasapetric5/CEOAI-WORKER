import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSkillIntakeReport,
  classifySkillCandidate,
  createSkillContentHash,
  deduplicateSkillCandidates,
  selectRelevantSkills
} from "../src/v5-modules/skill-library-intake.mjs";

const source = { repository: "example/skills", ref: "a1b2c3d4", path: "skills/test/SKILL.md" };
const approved = {
  id: "safe-test-skill", name: "Security Test Review", description: "Review security and tests",
  category: "security-and-privacy", tags: ["security", "test"], intents: ["review"],
  source, content_hash: "hash-001", license_status: "approved", security_status: "passed",
  test_status: "passed", input_contract: {type:"object"}, output_contract: {type:"object"},
  review_status: "approved", runtime_status: "enabled", applications: ["ceoai"],
  external_actions: false, paid_services: false
};

test("classifies priority, applications, readiness and missing provenance without enabling a skill", () => {
  const result = classifySkillCandidate({id:"agent-health",name:"Agent Health Monitoring",description:"agent routing and evaluation",tags:["agent","health"]});
  assert.equal(result.category, "agent-orchestration-and-quality");
  assert.ok(result.applications.includes("ceoai"));
  assert.equal(result.status, "needs-provenance");
  assert.equal(result.hard_gate_passed, false);
});

test("blocks candidates with unknown licenses or unsafe security status", () => {
  const unknown = classifySkillCandidate({...approved, license_status:"unknown"});
  assert.equal(unknown.status, "blocked-review");
  assert.equal(unknown.hard_gate_passed, false);
  const unsafe = classifySkillCandidate({...approved, security_status:"unsafe"});
  assert.equal(unsafe.status, "blocked-review");
  assert.equal(unsafe.hard_gate_passed, false);
});

test("deduplicates by stable ID, content hash, and pinned source", () => {
  const result = deduplicateSkillCandidates([
    approved,
    {...approved, id:"second-id"},
    {...approved, id:"third-id", content_hash:"hash-003", source:{...source,path:"skills/other/SKILL.md"}},
    {...approved, id:"fourth-id", content_hash:"hash-004", source:{...source,ref:"d4c3b2a1"}}
  ]);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].reason, "duplicate-content-hash");
});

test("intake report keeps inventory and runtime counts separate", () => {
  const report = buildSkillIntakeReport([approved, {...approved, id:"untrusted", content_hash:"hash-untrusted", source:{...source, path:"skills/untrusted/SKILL.md"}, license_status:"unknown"}]);
  assert.equal(report.summary.input_count, 2);
  assert.equal(report.summary.unique_count, 2);
  assert.equal(report.summary.runtime_enabled_count, 0);
  assert.equal(report.summary.ready_for_owner_review_count, 1);
  assert.equal(report.candidates.find(item => item.id === "untrusted").status, "blocked-review");
});

test("relevance selector returns only approved, enabled, app-compatible skills", () => {
  const results = selectRelevantSkills([
    approved,
    {...approved, id:"not-approved", review_status:"queued"},
    {...approved, id:"paid", paid_services:true},
    {...approved, id:"wrong-app", applications:["contentcraft"]}
  ], {application:"ceoai", description:"security test review", intent:"review"});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, approved.id);
  assert.ok(results[0].relevance_score > 0);
});

test("content hashes are deterministic SHA-256 hex strings", () => {
  const first = createSkillContentHash("hello skill");
  assert.equal(first, createSkillContentHash("hello skill"));
  assert.match(first, /^[a-f0-9]{64}$/);
});
