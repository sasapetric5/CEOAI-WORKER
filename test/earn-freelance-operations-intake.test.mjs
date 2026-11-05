import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/earn/", import.meta.url);
const ids = [
  "freelance-capacity-planner",
  "freelance-scope-change-estimator",
  "freelance-payment-reconciliation",
  "freelance-income-record-organizer",
  "open-source-contribution-planner",
];

for (const id of ids) {
  test("EARN skill is quarantined, bounded, and permission-limited: " + id, async () => {
    const body = await readFile(new URL(id + "/SKILL.md", root), "utf8");
    assert.match(body, /^---\n/);
    assert.ok(body.includes("name: " + id));
    assert.match(body, /\nstatus: quarantined\n/);
    assert.ok(Buffer.byteLength(body, "utf8") < 12 * 1024);
    assert.match(body, /No runtime activation or tool grants/);
  });
}

test("catalogue lists the five additions and runtime registry excludes them", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(readme, /Skill documents: 26/);
  assert.match(readme, /Runtime seed additions: 0/);
  assert.match(readme, /Tool grants: 0/);
  for (const id of ids) assert.ok(readme.includes(id));
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const id of ids) assert.ok(!builtins.includes(id), "unexpected runtime activation: " + id);
});
