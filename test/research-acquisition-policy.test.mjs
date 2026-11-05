import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResearchUrl, planResearchAcquisition } from "../src/agent/research-acquisition-policy.mjs";

test("single-page URL reads prefer Jina and retain a free-search fallback", () => {
  const plan = planResearchAcquisition({
    task: "Summarize https://docs.example.com/guide#section",
    jinaAvailable: true, freeSearchAvailable: true,
  });
  assert.equal(plan.strategy, "jina_read");
  assert.equal(plan.url, "https://docs.example.com/guide");
  assert.equal(plan.fallbackStrategy, "duckduckgo_search");
});

test("search tasks use free discovery when no direct URL is supplied", () => {
  const plan = planResearchAcquisition({
    task: "Research Cloudflare queue retry behavior", freeSearchAvailable: true,
  });
  assert.equal(plan.strategy, "duckduckgo_search");
  assert.equal(plan.query, "Research Cloudflare queue retry behavior");
});

test("a direct read falls back to free search when Jina is unavailable", () => {
  const plan = planResearchAcquisition({
    task: "Read https://docs.example.com/guide and compare",
    jinaAvailable: false, freeSearchAvailable: true,
  });
  assert.equal(plan.strategy, "duckduckgo_search");
  assert.equal(plan.reason, "jina_unavailable");
});

test("Browser Run is never selected without explicit caller capability and budget", () => {
  const unauthorized = planResearchAcquisition({
    task: "Crawl https://docs.example.com/ across pages",
    browserRunRequested: true, browserRunAuthorized: false,
    browserRunBudgetAvailable: true, jinaAvailable: true, freeSearchAvailable: true,
  });
  assert.equal(unauthorized.strategy, "jina_read");
  assert.equal(unauthorized.reason, "BROWSER_RUN_NOT_AUTHORIZED");
  const exhausted = planResearchAcquisition({
    task: "Crawl https://docs.example.com/ across pages",
    browserRunRequested: true, browserRunAuthorized: true,
    browserRunBudgetAvailable: false, jinaAvailable: false, freeSearchAvailable: true,
  });
  assert.equal(exhausted.strategy, "duckduckgo_search");
  assert.equal(exhausted.reason, "BROWSER_RUN_DAILY_QUOTA_EXHAUSTED");
});

test("Browser Run requires explicit intent, authorization and an available daily slot", () => {
  const plan = planResearchAcquisition({
    task: "Crawl https://docs.example.com/ across pages",
    browserRunRequested: true, browserRunAuthorized: true,
    browserRunBudgetAvailable: true, jinaAvailable: true, freeSearchAvailable: true,
  });
  assert.equal(plan.strategy, "browser_run_crawl");
  assert.equal(plan.reason, "explicit_crawl_authorized_and_budgeted");
  assert.equal(plan.fallbackStrategy, "jina_read");
});

test("credential-bearing and local URLs are rejected before Jina is called", () => {
  assert.equal(normalizeResearchUrl("https://user:secret@docs.example.com/guide"), null);
  assert.equal(normalizeResearchUrl("https://127.0.0.1/admin"), null);
  assert.equal(normalizeResearchUrl("https://worker.internal/private"), null);
});

test("sensitive URL query parameters are removed before remote reading", () => {
  assert.equal(
    normalizeResearchUrl("https://docs.example.com/guide?topic=queues&access_token=private#top"),
    "https://docs.example.com/guide?topic=queues"
  );
});
