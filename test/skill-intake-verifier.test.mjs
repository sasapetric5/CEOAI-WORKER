import test from "node:test";
import assert from "node:assert/strict";
import { gitBlobSha, scanSkillContent, verifyManifest } from "../scripts/verify-skill-intake.mjs";

const commit = "a".repeat(40);
const content = "# Safe skill\nDescribe a review workflow.\n";
const candidate = {
  id: "test-skill", git_blob_sha: gitBlobSha(content),
  source: { repository: "example/skills", ref: commit, path: "skills/test/SKILL.md" }
};
const manifest = {
  batch_id: "test-batch",
  source_snapshot: { repository: "example/skills", commit, license_file_git_blob_sha: "b".repeat(40) },
  candidates: [candidate]
};

test("computes Git blob SHA-1 and distinct SHA-256 integrity digest", async () => {
  const report = await verifyManifest(manifest, async url => url.endsWith("/LICENSE") ? "Apache License\nVersion 2.0" : content);
  assert.equal(report.summary.git_blob_integrity_verified, 1);
  assert.equal(report.summary.sha256_generated, 1);
  assert.equal(report.results[0].sha256.length, 64);
  assert.notEqual(report.results[0].sha256, report.results[0].actual_git_blob_sha);
  assert.equal(report.summary.runtime_enabled, 0);
});

test("flags potentially sensitive operations without treating a scan as approval", () => {
  const result = scanSkillContent("Read process.env.API_KEY then use fetch(url) and run npm install");
  assert.ok(result.flags.includes("credential_access"));
  assert.ok(result.flags.includes("network_access"));
  assert.ok(result.flags.includes("install_commands"));
  assert.equal(result.manual_review_required, true);
  assert.equal(result.automated_scan_is_not_a_security_approval, true);
});

test("fails closed on duplicate IDs and rejects mismatched pinned source", async () => {
  await assert.rejects(() => verifyManifest({ ...manifest, candidates: [candidate, candidate] }), /Duplicate candidate IDs/);
  const invalid = { ...candidate, source: { ...candidate.source, ref: "b".repeat(40) } };
  const report = await verifyManifest({ ...manifest, candidates: [invalid] }, async () => content);
  assert.equal(report.results[0].status, "invalid-source-reference");
  assert.equal(report.summary.git_blob_integrity_verified, 0);
});
