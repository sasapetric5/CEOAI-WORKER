import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/earn/", import.meta.url);
const ids = [
  "freelance-niche-opportunity-mapper",
  "public-business-prospect-research",
  "freelance-discovery-call-planner",
  "freelance-retainer-planner",
  "freelance-project-profitability-checker",
];

for (const id of ids) {
  test("freelance earning skill is quarantined and bounded: " + id, async () => {
    const body = await readFile(new URL(id + "/SKILL.md", root), "utf8");
    assert.match(body, /^---\n/);
    assert.ok(body.includes("name: " + id));
    assert.match(body, /\nstatus: quarantined\n/);
    assert.ok(Buffer.byteLength(body, "utf8") < 12 * 1024);
    assert.match(body, /No runtime activation or tool grants/);
  });
}

test("catalogue registers this five-skill batch without runtime activation", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(readme, /Skill documents: 100/);
  assert.match(readme, /Runtime seed additions: 0/);
  assert.match(readme, /Tool grants: 0/);
  for (const id of ids) assert.ok(readme.includes(id));
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const id of ids) assert.ok(!builtins.includes(id), "unexpected runtime activation: " + id);
});
