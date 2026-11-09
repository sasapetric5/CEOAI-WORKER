import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/seo/", import.meta.url);
const skills = [
  ["technical-seo-auditor/SKILL.md", "technical_seo_auditor"],
  ["aeo-answer-engine-optimizer/SKILL.md", "aeo_answer_engine_optimizer"],
  ["keyword-intent-research/SKILL.md", "keyword_intent_research"],
  ["content-gap-analyzer/SKILL.md", "content_gap_analyzer"],
];
const read = (path) => readFile(new URL(path, root), "utf8");

for (const [path] of skills) {
  test("SEO skill is present, quarantined, and bounded: " + path, async () => {
    const body = await read(path);
    assert.match(body, /^---\n/);
    assert.match(body, /\nname: [a-z0-9-]+\n/);
    assert.match(body, /\nstatus: quarantined\n/);
    assert.ok(Buffer.byteLength(body, "utf8") < 16 * 1024);
    assert.ok(!body.includes("\\0"));
    assert.match(body, /No runtime activation|No runtime activation or tool grants|outside runtime seed/i);
  });
}

test("SEO catalog lists all four quarantined workflows", async () => {
  const readme = await readFile(new URL("../skills/catalog/external/seo/README.md", import.meta.url), "utf8");
  for (const [path] of skills) assert.ok(readme.includes(path.split("/")[0]));
  assert.match(readme, /Skill documents: 7/);
  assert.match(readme, /Tool grants: 0/);
});

test("global research policy and existing Spider are preserved", async () => {
  const bodies = await Promise.all(skills.map(([path]) => read(path)));
  for (const body of bodies) {
    assert.match(body, /worldwide/i);
    assert.match(body, /existing guarded Spider/i);
    assert.doesNotMatch(body, /Serbia-only|only in Serbia/i);
    assert.match(body, /No runtime activation|No runtime activation or tool grants|No runtime activation/i);
  }
});

test("SEO/AEO workflows avoid fabricated metrics and guarantees", async () => {
  const keyword = await read("keyword-intent-research/SKILL.md");
  const aeo = await read("aeo-answer-engine-optimizer/SKILL.md");
  const gap = await read("content-gap-analyzer/SKILL.md");
  assert.match(keyword, /Do not report search volume/i);
  assert.match(aeo, /not a promise of inclusion or citation/i);
  assert.match(gap, /Never fabricate search demand/i);
});

test("all SEO skills remain outside runtime built-ins", async () => {
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const [, id] of skills) assert.ok(!builtins.includes(id), "unexpected runtime activation: " + id);
});
