import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../skills/catalog/external/earn/", import.meta.url);
const ids = [
  "ai-automation-workflow-mapper",
  "ai-automation-feasibility-estimator",
  "seo-audit-client-report-builder",
  "bounty-reward-terms-verifier",
  "spreadsheet-cleanup-service-planner",
  "ai-agent-prototype-planner",
  "client-code-maintenance-estimator",
  "web-app-delivery-planner",
  "rest-api-integration-planner",
  "webhook-integration-validator",
  "api-contract-test-designer",
  "business-process-automation-planner",
  "open-source-good-first-issue-qualifier",
  "ai-agent-evaluation-service-planner",
  "ai-agent-knowledge-base-audit",
  "website-performance-audit-service",
  "technical-seo-implementation-qa",
  "ecommerce-catalog-data-cleanup-planner",
  "no-code-automation-migration-planner",
  "open-source-bounty-due-diligence",
  "freelance-service-acceptance-criteria-builder",
  "chatbot-build-service-scope",
  "seo-content-refresh-service-planner",
  "localization-translation-qa-service",
  "data-dashboard-reporting-service-planner",
  "spreadsheet-formula-repair-service",
  "wordpress-site-maintenance-audit",
  "freelance-proposal-and-quote-builder",
  "freelance-client-onboarding-checklist",
  "freelance-lead-qualification-research",
  "freelance-marketplace-job-bid-analyzer",
  "digital-product-microoffer-validator",
  "digital-template-product-planner",
  "affiliate-program-terms-auditor",
  "freelance-recurring-service-opportunity-mapper",
  "open-source-maintainer-service-opportunity-finder",
  "freelance-portfolio-proof-verifier",
  "website-accessibility-audit-service",
  "website-security-configuration-review",
  "analytics-event-taxonomy-planner",
  "crm-data-quality-audit-planner",
  "software-test-case-authoring-service",
  "technical-documentation-service-planner",
  "website-migration-readiness-audit",
  "freelance-service-profitability-scenario-modeler",
  "api-integration-failure-triage-service",
  "reproducible-software-bug-report-service",
  "software-release-readiness-audit",
  "technical-changelog-and-release-notes-service",
  "open-source-license-compatibility-review",
  "data-import-validation-service-planner",
  "privacy-data-flow-inventory-planner",
  "client-website-incident-postmortem-writer",
];

for (const id of ids) {
  test("specialist EARN skill is quarantined and bounded: " + id, async () => {
    const body = await readFile(new URL(id + "/SKILL.md", root), "utf8");
    assert.match(body, /^---\n/);
    assert.ok(body.includes("name: " + id));
    assert.match(body, /\nstatus: quarantined\n/);
    assert.ok(Buffer.byteLength(body, "utf8") < 12 * 1024);
    assert.match(body, /No runtime activation or tool grants/);
  });
}

test("EARN catalogue records the batch and runtime registry excludes it", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(readme, /Skill documents: 79/);
  assert.match(readme, /Runtime seed additions: 0/);
  assert.match(readme, /Tool grants: 0/);
  for (const id of ids) assert.ok(readme.includes(id));
  const builtins = await readFile(new URL("../src/agent/builtin-skills.mjs", import.meta.url), "utf8");
  for (const id of ids) assert.ok(!builtins.includes(id), "unexpected runtime activation: " + id);
});
