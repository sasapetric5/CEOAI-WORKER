import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skillUrl = new URL("../skills/catalog/external/seo/technical-seo-auditor/SKILL.md", import.meta.url);
const readSkill = () => readFile(skillUrl, "utf8");

test("technical SEO auditor has valid quarantined metadata", async () => {
  const body = await readSkill();
  assert.match(body, /^---\n/);
  assert.match(body, /\nname: technical-seo-auditor\n/);
  assert.match(body, /\nlicense: MIT\n/);
  assert.match(body, /\ncategory: SEO\n/);
  assert.match(body, /\nstatus: quarantined\n/);
  assert.ok(Buffer.byteLength(body, "utf8") < 16 * 1024);
});

test("technical SEO workflow is worldwide and uses existing Spider only", async () => {
  const body = await readSkill();
  assert.match(body, /Work worldwide/i);
  assert.match(body, /existing guarded Spider/i);
  assert.doesNotMatch(body, /Serbia-only|only in Serbia/i);
  assert.doesNotMatch(body, /create another crawler/i);
});

test("audit requires evidence, bounded sampling, and honest unknowns", async () => {
  const body = await readSkill();
  assert.match(body, /sample size/i);
  assert.match(body, /evidence URL/i);
  assert.match(body, /UNKNOWN/i);
  assert.match(body, /Separate observed facts from hypotheses/i);
});

test("SEO skill forbids paid dependencies and external side effects", async () => {
  const body = await readSkill();
  assert.match(body, /No paid SEO crawlers/i);
  assert.match(body, /No website edits/i);
  assert.match(body, /No automatic activation or tool permissions/i);
});

test("SEO skill is not added to runtime built-ins", async () => {
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  assert.ok(!builtins.includes("technical_seo_auditor"));
});
