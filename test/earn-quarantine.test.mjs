import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/earn/", import.meta.url);
const docs = [
  "bounty-hunter/SKILL.md",
  "cashclaw/competitor-research/SKILL.md",
  "cashclaw/content-delivery/SKILL.md",
];
const read = (path) => readFile(new URL(path, root), "utf8");

for (const path of docs) {
  test("EARN skill is present and quarantined: " + path, async () => {
    const body = await read(path);
    assert.ok(body.startsWith("---\n"));
    assert.match(body, /status: quarantined/);
    assert.match(body, /license: MIT/);
    assert.ok(Buffer.byteLength(body, "utf8") < 16 * 1024);
    assert.ok(!body.includes("\\0"));
  });
}

test("both upstream MIT license notices are retained", async () => {
  assert.match(await read("bounty-hunter/LICENSE"), /Copyright \(c\) 2026 1sadjlk/);
  assert.match(await read("cashclaw/LICENSE"), /Copyright \(c\) 2026 Ertugrul Akben/);
});

test("pack review confirms quarantine and no runtime permissions", async () => {
  const review = await read("PACK-REVIEW.md");
  assert.match(review, /Runtime activation: none/);
  assert.match(review, /Tool grants: none/);
  assert.match(review, /External side effects: prohibited/);
});

test("bounty skill forbids claims, payout, secrets, and unapproved testing", async () => {
  const body = await read("bounty-hunter/SKILL.md");
  for (const phrase of ["Never claim, reserve, comment, apply", "Never sign messages/transactions", "Never request, store, or use passwords", "Bug-bounty testing is outside this skill"]) {
    assert.ok(body.includes(phrase), "missing guardrail: " + phrase);
  }
});

test("freelance deliverables are draft/research only and reject paid dependencies", async () => {
  const a = await read("cashclaw/competitor-research/SKILL.md");
  const b = await read("cashclaw/content-delivery/SKILL.md");
  assert.match(a, /Do not use paid data providers or paid SEO tools/);
  assert.match(a, /No outreach, email, messaging/);
  assert.match(b, /Drafts only/);
  assert.match(b, /Do not guarantee rankings, engagement, leads, conversions, or revenue/);
});

test("EARN intake is not added to runtime seed", async () => {
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const id of ["bounty_opportunity_scout", "freelance_competitor_research", "freelance_content_delivery"]) {
    assert.ok(!builtins.includes(id));
  }
});
