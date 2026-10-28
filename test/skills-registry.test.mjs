import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const registryPath = resolve(root, "skills/registry.json");

test("shared skill registry is valid and safe by default", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(registry.library_id, "ceoai-shared-skills");
  assert.equal(registry.routing_policy.load_all_skills, false);
  assert.equal(registry.routing_policy.default_external_actions, "disabled");
  assert.equal(registry.routing_policy.default_paid_services, "disabled");
  assert.ok(Array.isArray(registry.categories));
  assert.ok(Array.isArray(registry.skills));
  assert.ok(registry.skills.length > 0);
});

test("skill IDs are unique and every skill has a valid category and existing file", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const categoryIds = new Set(registry.categories.map((category) => category.id));
  const skillIds = registry.skills.map((skill) => skill.id);
  assert.equal(new Set(skillIds).size, skillIds.length, "duplicate skill IDs found");

  for (const skill of registry.skills) {
    assert.ok(skill.id && skill.name && skill.path, "skill metadata is incomplete");
    assert.ok(categoryIds.has(skill.category), `unknown category for ${skill.id}`);
    assert.ok(skill.source?.repository && skill.source?.ref && skill.source?.path, `missing provenance for ${skill.id}`);
    assert.equal(skill.external_actions, false, `${skill.id} must not enable external actions by default`);
    await access(resolve(root, skill.path));
  }
});

test("unreviewed skills cannot be marked runtime-enabled", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  for (const skill of registry.skills) {
    if (skill.license_status !== "approved" || skill.security_status !== "verified") {
      assert.notEqual(skill.runtime_status, "enabled", `${skill.id} is enabled before review`);
    }
  }
});
