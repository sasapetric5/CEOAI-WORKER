import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/freelance/", import.meta.url);
const skills = [
  "client-vetting/SKILL.md",
  "quote-job/SKILL.md",
  "billing-model/SKILL.md",
  "proposal-write/SKILL.md",
  "contract-review/SKILL.md",
  "access-request/SKILL.md",
  "scope-check/SKILL.md",
  "status-update/SKILL.md",
  "client-education/SKILL.md",
  "weekly-review/SKILL.md",
  "invoice-prep/SKILL.md"
];
const read = (path) => readFile(new URL(path, root), "utf8");

for (const path of skills) {
  test(`freelance skill is present and has valid frontmatter: ${path}`, async () => {
    const body = await read(path);
    assert.ok(body.startsWith("---\n"), "frontmatter missing");
    assert.match(body, /\nname:\s*[a-z0-9-]+\n/);
    assert.match(body, /\ndescription:\s*.+\n/);
    assert.ok(Buffer.byteLength(body, "utf8") <= 16 * 1024);
    assert.ok(!body.includes("\\0"));
  });
}

test("upstream MIT license is retained", async () => {
  const license = await read("LICENSE");
  assert.ok(license.includes("MIT License"));
  assert.ok(license.includes("Copyright (c) 2026 Cale Lamb"));
});

test("intake review keeps all freelance skills quarantined", async () => {
  const review = await read("PACK-REVIEW.md");
  assert.ok(review.includes("QUARANTINED / NOT RUNTIME-ACTIVE"));
  assert.ok(review.includes("Runtime activation: none"));
  assert.ok(review.includes("Tool permissions granted: none"));
  assert.ok(review.includes("No autonomous client contact"));
});

test("README lists every imported freelance skill", async () => {
  const readme = await read("README.md");
  for (const path of skills) assert.ok(readme.includes(path.split("/")[0]));
});

test("all imported skills remain outside built-in runtime seed", async () => {
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const id of [
    "client_vetting", "quote_job", "billing_model", "proposal_write", "contract_review",
    "access_request", "scope_check", "status_update", "client_education", "weekly_review", "invoice_prep"
  ]) assert.ok(!builtins.includes(id), `unexpected runtime activation: ${id}`);
});
