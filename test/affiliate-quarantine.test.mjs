import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/affiliate/", import.meta.url);
const skills = [
  "analytics/seo-audit/SKILL.md",
  "analytics/internal-linking-optimizer/SKILL.md",
  "analytics/performance-report/SKILL.md",
  "blog/keyword-cluster-architect/SKILL.md",
  "blog/content-decay-detector/SKILL.md",
  "content/content-research-brief/SKILL.md",
  "research/niche-opportunity-finder/SKILL.md",
  "research/content-angle-ranker/SKILL.md",
  "research/purple-cow-audit/SKILL.md",
  "meta/compliance-checker/SKILL.md",
  "automation/content-repurposer/SKILL.md",
];
const references = [
  "shared/references/affiliate-glossary.md",
  "shared/references/flywheel-connections.md",
  "shared/references/seo-strategy.md",
  "shared/references/case-studies.md",
  "shared/references/feedback-protocol.md",
  "shared/references/ftc-compliance.md",
  "shared/references/platform-rules.md",
  "shared/references/affitor-branding.md",
  "skills/research/affiliate-program-search/references/openaffiliate-api.md",
];
const read = (path) => readFile(new URL(path, root), "utf8");

for (const path of skills) {
  test(`quarantined affiliate skill exists with MIT provenance: ${path}`, async () => {
    const body = await read(path);
    assert.ok(body.startsWith("---\n"));
    assert.ok(body.includes("license: MIT"));
    assert.ok(body.includes('version: "1.0.0"'));
    assert.ok(Buffer.byteLength(body, "utf8") <= 24 * 1024);
    assert.ok(!body.includes("\\0"));
  });
}

test("all referenced supporting documents are mirrored", async () => {
  for (const path of references) await access(new URL(path, root));
});

test("upstream MIT license is retained", async () => {
  const license = await read("LICENSE");
  assert.ok(license.includes("MIT License"));
  assert.ok(license.includes("Copyright (c) 2026 Affitor"));
});

test("intake review explicitly keeps the imported pack quarantined", async () => {
  const review = await read("PACK-REVIEW.md");
  assert.ok(review.includes("QUARANTINED / NOT RUNTIME-ACTIVE"));
  assert.ok(review.includes("Runtime seed additions: 0"));
  assert.ok(review.includes("Tool grants: 0"));
  assert.ok(review.includes("No publishing, scheduling, posting, email sending"));
  assert.ok(review.includes("OpenAffiliate"));
});

test("affiliate README lists every newly imported skill", async () => {
  const readme = await read("README.md");
  for (const path of skills) {
    const slug = path.replace("/SKILL.md", "");
    assert.ok(readme.includes(slug), `README missing ${slug}`);
  }
});

test("new skills remain outside the built-in runtime seed", async () => {
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const id of [
    "seo_audit", "internal_linking_optimizer", "performance_report",
    "keyword_cluster_architect", "content_decay_detector", "content_research_brief",
    "niche_opportunity_finder", "content_angle_ranker", "purple_cow_audit",
    "compliance_checker", "content_repurposer",
  ]) assert.ok(!builtins.includes(id), `unexpected runtime activation: ${id}`);
});

test("source documents contain no executable script code blocks", async () => {
  const scriptFences = ["```bash", "```sh", "```python", "```javascript", "```js", "```typescript", "```ts"];
  for (const path of skills) {
    const body = await read(path);
    for (const fence of scriptFences) assert.ok(!body.includes(fence), `executable block found in ${path}`);
  }
});
