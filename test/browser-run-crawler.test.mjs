import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserRunCrawler, normalizeBrowserRunUrl } from "../src/integrations/browser-run-crawler.mjs";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "test-browser-run-token";

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls.length);
  };
  return { fetchImpl, calls };
}

test("normalizes public HTTPS crawl URLs and removes credential-like query values", () => {
  assert.equal(
    normalizeBrowserRunUrl("https://docs.example.com/path?topic=workers&token=secret#section"),
    "https://docs.example.com/path?topic=workers"
  );
});

test("rejects HTTP, local hosts, IP literals, credentials and custom ports", () => {
  const invalid = [
    "http://example.com",
    "https://localhost",
    "https://worker.internal",
    "https://192.168.1.1",
    "https://127.0.0.1",
    "https://[::1]/",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://metadata.google.internal",
  ];
  for (const url of invalid) assert.equal(normalizeBrowserRunUrl(url), null, url);
});

test("requires a valid Cloudflare account ID and API token", () => {
  assert.throws(() => createBrowserRunCrawler({ accountId: "bad", apiToken: TOKEN }), /ACCOUNT_ID/);
  assert.throws(() => createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: "" }), /TOKEN_REQUIRED/);
});

test("startCrawl submits a bounded non-rendered reference-only crawl", async () => {
  const fake = fakeFetch(async (url, options) => {
    assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT + "/browser-run/crawl");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer " + TOKEN);
    const body = JSON.parse(options.body);
    assert.equal(body.render, false);
    assert.deepEqual(body.formats, ["markdown"]);
    assert.deepEqual(body.crawlPurposes, ["search", "ai-input"]);
    assert.equal(body.contentUse, "reference");
    assert.equal(body.limit, 12);
    assert.equal(body.depth, 1);
    assert.equal(body.options.includeExternalLinks, false);
    assert.equal(body.options.includeSubdomains, false);
    assert.deepEqual(body.options.includePatterns, ["https://docs.example.com/**"]);
    return Response.json({ success: true, result: "crawl_job_12345678" });
  });
  const crawler = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: fake.fetchImpl });
  const result = await crawler.startCrawl({ url: "https://docs.example.com/start", pageLimit: 12, depth: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.jobId, "crawl_job_12345678");
  assert.equal(result.render, false);
  assert.equal(fake.calls.length, 1);
});

test("does not make a request for unsafe URLs or limits above the internal free-tier cap", async () => {
  const fake = fakeFetch(async () => Response.json({ success: true, result: "crawl_job_12345678" }));
  const crawler = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: fake.fetchImpl });
  assert.equal((await crawler.startCrawl({ url: "http://127.0.0.1" })).code, "CRAWL_URL_REJECTED");
  assert.equal((await crawler.startCrawl({ url: "https://docs.example.com", pageLimit: 21 })).code, "CRAWL_PAGE_LIMIT_REJECTED");
  assert.equal((await crawler.startCrawl({ url: "https://docs.example.com", depth: 3 })).code, "CRAWL_DEPTH_REJECTED");
  assert.equal(fake.calls.length, 0);
});

test("maps provider rate limits without exposing upstream response details", async () => {
  const fake = fakeFetch(async () => new Response("secret upstream diagnostic", { status: 429, headers: { "Retry-After": "90" } }));
  const crawler = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: fake.fetchImpl });
  const result = await crawler.startCrawl({ url: "https://docs.example.com" });
  assert.deepEqual(result, { ok: false, code: "CRAWL_RATE_LIMITED", retryAfterSeconds: 90 });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("maps authentication failures to a safe error code", async () => {
  const fake = fakeFetch(async () => new Response("token leaked by upstream", { status: 403 }));
  const crawler = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: fake.fetchImpl });
  const result = await crawler.startCrawl({ url: "https://docs.example.com" });
  assert.deepEqual(result, { ok: false, code: "CRAWL_AUTH_FAILED" });
});

test("maps network timeouts and upstream failures safely", async () => {
  const timedOut = fakeFetch(async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; });
  const crawler1 = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: timedOut.fetchImpl });
  assert.equal((await crawler1.startCrawl({ url: "https://docs.example.com" })).code, "CRAWL_TIMEOUT");
  const failed = fakeFetch(async () => { throw new Error("secret network failure"); });
  const crawler2 = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: failed.fetchImpl });
  const result = await crawler2.startCrawl({ url: "https://docs.example.com" });
  assert.deepEqual(result, { ok: false, code: "CRAWL_PROVIDER_UNAVAILABLE" });
});

test("getStatus requests only lightweight status and validates the job ID", async () => {
  const fake = fakeFetch(async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(url.endsWith("/crawl_job_12345678?limit=1"), true);
    return Response.json({ success: true, result: { status: "running", total: 8, finished: 3 } });
  });
  const crawler = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: fake.fetchImpl });
  assert.equal((await crawler.getStatus("../bad")).code, "CRAWL_INVALID_JOB_ID");
  const result = await crawler.getStatus("crawl_job_12345678");
  assert.equal(result.ok, true);
  assert.equal(result.status, "running");
  assert.equal(result.finished, 3);
  assert.equal(result.terminal, false);
  assert.equal(fake.calls.length, 1);
});

test("getResults returns only bounded completed markdown records with sanitized URLs", async () => {
  const fake = fakeFetch(async (url) => {
    assert.equal(url.endsWith("/crawl_job_12345678?limit=2&status=completed"), true);
    return Response.json({
      success: true,
      result: {
        id: "crawl_job_12345678", status: "completed", total: 2, finished: 2,
        records: [
          { url: "https://docs.example.com/a?token=private", status: "completed", outcome: "success", markdown: "# Page A", metadata: { title: "Page A", status: 200 } },
          { url: "http://127.0.0.1/private", status: "completed", outcome: "success", markdown: "must be discarded" },
          { url: "https://docs.example.com/b", status: "errored", outcome: "error", markdown: "must be discarded" },
        ],
      },
    });
  });
  const crawler = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: fake.fetchImpl });
  const result = await crawler.getResults("crawl_job_12345678", { limit: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].url, "https://docs.example.com/a");
  assert.equal(result.records[0].markdown, "# Page A");
  assert.equal(result.records[0].title, "Page A");
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("getResults does not return records before the crawl completes", async () => {
  const fake = fakeFetch(async () => Response.json({
    success: true,
    result: { id: "crawl_job_12345678", status: "running", records: [{ markdown: "not ready" }] },
  }));
  const crawler = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: fake.fetchImpl });
  const result = await crawler.getResults("crawl_job_12345678");
  assert.equal(result.ok, true);
  assert.equal(result.status, "running");
  assert.deepEqual(result.records, []);
});

test("rejects oversized and invalid JSON responses", async () => {
  const oversized = fakeFetch(async () => new Response("x".repeat(2_000_001), { status: 200 }));
  const crawler1 = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: oversized.fetchImpl });
  assert.equal((await crawler1.startCrawl({ url: "https://docs.example.com" })).code, "CRAWL_INVALID_RESPONSE");
  const invalidJson = fakeFetch(async () => new Response("not-json", { status: 200 }));
  const crawler2 = createBrowserRunCrawler({ accountId: ACCOUNT, apiToken: TOKEN, fetchImpl: invalidJson.fetchImpl });
  assert.equal((await crawler2.startCrawl({ url: "https://docs.example.com" })).code, "CRAWL_INVALID_RESPONSE");
});
