import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/earn/", import.meta.url);
const skills = [
  "portfolio-case-study-builder",
  "freelance-service-packager",
  "work-sample-planner",
  "freelance-platform-policy-checker",
  "remote-job-risk-reviewer",
];
for (const id of skills) {
  test("EARN skill is present, quarantined, bounded, and permission-limited: " + id, async () => {
    const body = await readFile(new URL(id + "/SKILL.md", root), "utf8");
    assert.match(body, /^---\n/);
    assert.match(body, new RegExp("\\nname: " + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n"));
    assert.match(body, /\nstatus: quarantined\n/);
    assert.ok(Buffer.byteLength(body, "utf8") < 12 * 1024);
    assert.match(body, /No runtime activation or tool grants/);
    assert.match(body, /Worldwide|worldwide/);
  });
}
test("EARN pack registers all five new skills without runtime seed additions", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(readme, /Skill documents: 11/);
  assert.match(readme, /Runtime seed additions: 0/);
  assert.match(readme, /Tool grants: 0/);
  for (const id of skills) assert.ok(readme.includes(id));
  const builtins = await readFile(new URL("../agent/builtin-skills.mjs", new URL("../../src/", import.meta.url)), "utf8").catch(async () => {
    return readFile(new URL("../../../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  });
  for (const id of skills) assert.ok(!builtins.includes(id), "unexpected runtime activation: " + id);
});
