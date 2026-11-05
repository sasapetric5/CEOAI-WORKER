import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("./upstream/registry.json", import.meta.url), "utf8"));
const statuses = new Set(manifest.policy.statuses);

test("upstream registry has a supported schema and conservative reuse policy", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.policy.onlyPinnedCommits, true);
  assert.equal(manifest.policy.onlyCountExecutedPass, true);
  assert.equal(manifest.policy.requireLicenseReview, true);
  assert.equal(manifest.policy.noPaidApis, true);
  assert.equal(manifest.policy.noSecrets, true);
});

test("upstream source IDs are unique and commits are pinned", () => {
  const ids = manifest.sources.map(source => source.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const source of manifest.sources) {
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.ok(source.repository.includes("/"));
    assert.ok(statuses.has(source.status));
    assert.equal(source.executionEvidence, null, "unexecuted imports must not claim pass evidence");
  }
});

test("every source records license, behavior, runtime and adaptation", () => {
  for (const source of manifest.sources) {
    assert.ok(source.license.length > 0);
    assert.ok(source.behavior.length > 0);
    assert.ok(source.runtime.length > 0);
    assert.ok(source.adaptation.length > 0);
    assert.equal(typeof source.licenseVerified, "boolean");
  }
});

test("only executed_pass records can count as successful", () => {
  for (const source of manifest.sources) {
    if (source.status !== "executed_pass") assert.equal(source.executionEvidence, null);
    if (source.status === "executed_pass") assert.ok(source.executionEvidence);
  }
});

test("Dify source is quarantined because its license has extra restrictions", () => {
  const dify = manifest.sources.find(source => source.project === "Dify");
  assert.equal(dify.status, "quarantined");
  assert.match(dify.license, /additional commercial/i);
});

test("CrewAI cannot be treated as a reusable test until its exact test path is pinned", () => {
  const crew = manifest.sources.find(source => source.project === "CrewAI");
  assert.equal(crew.status, "candidate");
  assert.equal(crew.path, null);
});
