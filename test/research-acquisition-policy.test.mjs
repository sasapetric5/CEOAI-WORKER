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


test("research URL normalization rejects alternate loopback and non-public address forms", () => {
  for (const value of [
    "http://127.0.0.1/admin",
    "http://2130706433/admin",
    "http://0x7f000001/admin",
    "http://[::1]/admin",
    "http://[::ffff:127.0.0.1]/admin",
    "http://0.0.0.0/admin",
    "http://metadata.google.internal/latest",
    "http://service.local/private",
    "file:///etc/passwd",
    "ftp://example.com/file",
  ]) {
    assert.equal(normalizeResearchUrl(value), null, value);
  }
});

test("research URL normalization strips multiple credential-like query parameters", () => {
  assert.equal(
    normalizeResearchUrl("https://docs.example.com/path?topic=queues&api_key=a&X-Amz-Signature=b&session_id=c&password=d"),
    "https://docs.example.com/path?topic=queues"
  );
});

test("research planning never forwards a supplied URL or its query credentials into free search text", () => {
  const plan = planResearchAcquisition({
    task: "Research this page https://docs.example.com/guide?api_key=private&topic=queues",
    jinaAvailable: false,
    freeSearchAvailable: true,
  });
  assert.equal(plan.strategy, "duckduckgo_search");
  assert.equal(plan.query.includes("api_key"), false);
  assert.equal(plan.query.includes("private"), false);
  assert.equal(plan.query.includes("docs.example.com"), false);
  assert.equal(plan.query.includes("topic=queues"), false);
});
