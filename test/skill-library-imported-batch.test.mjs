import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const manifest = JSON.parse(await readFile(new URL("../skills/intake-batch-001.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../skills/registry.json", import.meta.url), "utf8"));

function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\\0`).update(bytes).digest("hex");
}

test("all 50 pinned upstream skills are imported with exact source blob integrity", async () => {
  assert.equal(manifest.candidates.length, 50);
  const registryById = new Map(registry.skills.map(skill => [skill.id, skill]));
  for (const candidate of manifest.candidates) {
    const skill = registryById.get(candidate.name);
    assert.ok(skill, `missing registry entry: ${candidate.name}`);
    assert.equal(skill.path, `skill-library/imported/${candidate.name}/SKILL.md`);
    assert.equal(skill.source.repository, manifest.source_snapshot.repository);
    assert.equal(skill.source.ref, manifest.source_snapshot.commit);
    assert.equal(skill.source.path, candidate.source.path);
    assert.equal(skill.runtime_status, "not-enabled");
    assert.equal(skill.license_status, "pending-review");
    assert.equal(skill.security_status, "pending");
    const content = await readFile(new URL(`../${skill.path}`, import.meta.url), "utf8");
    assert.equal(gitBlobSha(content), candidate.git_blob_sha, `source integrity mismatch: ${candidate.name}`);
  }
});

test("imported candidates cannot enter runtime selection before review and tests", () => {
  for (const candidate of manifest.candidates) {
    const skill = registry.skills.find(item => item.id === candidate.name);
    assert.ok(skill);
    assert.equal(skill.runtime_status, "not-enabled");
    assert.equal(skill.review_status, "candidate");
    assert.equal(skill.external_actions, null);
    assert.equal(skill.paid_services, null);
  }
});
