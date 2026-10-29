import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const roadmap = JSON.parse(await readFile(new URL("../skills/roadmap-1000.json", import.meta.url), "utf8"));

test("1000-skill roadmap has exactly 1000 planned slots across non-overlapping category targets", () => {
  assert.equal(roadmap.target_skill_count, 1000);
  assert.equal(roadmap.category_targets.reduce((total, category) => total + category.target, 0), 1000);
  assert.equal(new Set(roadmap.category_targets.map((category) => category.id)).size, roadmap.category_targets.length);
});

test("skill roadmap fails closed on imports, execution, paid services, and external actions", () => {
  assert.equal(roadmap.policy.auto_import, false);
  assert.equal(roadmap.policy.auto_execute, false);
  assert.equal(roadmap.policy.paid_services_enabled, false);
  assert.equal(roadmap.policy.external_actions_enabled, false);
  assert.equal(roadmap.policy.explicit_owner_approval_before_runtime_enable, true);
  assert.equal(roadmap.policy.skill_level_license_review_required, true);
  assert.equal(roadmap.policy.security_review_required, true);
});

test("each rollout phase keeps candidate, verified, and runtime-enabled counts separate", () => {
  for (const phase of roadmap.rollout_phases) {
    assert.ok(Number.isInteger(phase.candidate_target));
    assert.ok(Number.isInteger(phase.verified_target));
    assert.ok(Number.isInteger(phase.runtime_enabled_target));
    assert.ok(phase.candidate_target >= phase.verified_target);
    assert.ok(phase.verified_target >= phase.runtime_enabled_target);
    assert.ok(Array.isArray(phase.exit_criteria) && phase.exit_criteria.length > 0);
  }
  const finalPhase = roadmap.rollout_phases.at(-1);
  assert.equal(finalPhase.candidate_target, 1000);
  assert.equal(finalPhase.verified_target, 800);
  assert.equal(finalPhase.runtime_enabled_target, 200);
});

test("quality dimensions sum to 100 and hard safety gates cannot be bypassed by score", () => {
  assert.equal(roadmap.quality_score.dimensions.reduce((total, dimension) => total + dimension.weight, 0), 100);
  assert.match(roadmap.quality_score.gate, /never overrides a failed license, security, free-only, or owner-approval gate/i);
});

test("intake records require source pinning, contracts, provenance, and test status", () => {
  const required = new Set(roadmap.intake_record_required_fields);
  for (const field of ["id", "input_contract", "output_contract", "source_commit_sha", "source_path", "content_hash", "license_status", "security_status", "test_status", "runtime_status"]) {
    assert.ok(required.has(field), `missing intake field: ${field}`);
  }
});
