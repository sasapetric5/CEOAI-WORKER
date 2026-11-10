import test from "node:test";
import assert from "node:assert/strict";
import { validatePinnedSkillCandidate } from "../src/agent/skill-candidate-provenance.mjs";

const valid = {
  id: "candidate-2026-001",
  repository: "trusted-org/skill-catalog",
  commit: "a".repeat(40),
  path: "skills/demo/SKILL.md",
  blobSha: "b".repeat(40)
};

test("accepts an immutable candidate tuple and normalizes Git object hashes", () => {
  const candidate = validatePinnedSkillCandidate(valid);
  assert.deepEqual(candidate, valid);
  assert.equal(Object.isFrozen(candidate), true);
});

test("rejects a missing or malformed candidate identity", () => {
  for (const id of ["", "../skill", "candidate with spaces", null]) {
    assert.throws(() => validatePinnedSkillCandidate({ ...valid, id }), /CANDIDATE_ID_INVALID/);
  }
});

test("accepts only owner/repository identifiers, not URLs or path tricks", () => {
  for (const repository of ["https://github.com/a/b", "a", "a/b/c", "../b/c", "a/../b"]) {
    assert.throws(() => validatePinnedSkillCandidate({ ...valid, repository }), /CANDIDATE_REPOSITORY_INVALID/);
  }
});

test("requires full immutable commit and blob SHA-1 values", () => {
  assert.throws(() => validatePinnedSkillCandidate({ ...valid, commit: "abc" }), /CANDIDATE_COMMIT_INVALID/);
  assert.throws(() => validatePinnedSkillCandidate({ ...valid, blobSha: "xyz" }), /CANDIDATE_BLOB_SHA_INVALID/);
});

test("rejects absolute, traversal, empty-segment and backslash paths", () => {
  for (const path of ["/skills/demo/SKILL.md", "../SKILL.md", "skills/../SKILL.md", "skills//SKILL.md", "skills\\demo\\SKILL.md"]) {
    assert.throws(() => validatePinnedSkillCandidate({ ...valid, path }), /CANDIDATE_PATH_INVALID/);
  }
});

test("requires the exact SKILL.md filename and bounded path length", () => {
  assert.throws(() => validatePinnedSkillCandidate({ ...valid, path: "skills/demo/README.md" }), /CANDIDATE_PATH_INVALID/);
  assert.throws(() => validatePinnedSkillCandidate({ ...valid, path: "a".repeat(513) + "/SKILL.md" }), /CANDIDATE_PATH_INVALID/);
});
