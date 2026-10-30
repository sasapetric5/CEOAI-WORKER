import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCloudflareSpiderInput,
  enqueueCloudflareSpiderJob,
  processCloudflareSpiderQueue,
  getCloudflareSpiderJob,
  normalizeBrowserRunRecords,
  handleCloudflareSpiderRequest,
  CLOUDFLARE_SPIDER_LIMITS,
} from "../src/v5-modules/spider-cloudflare-queue.mjs";

const baseEnv = {
  SPIDER_CLOUDFLARE_ENABLED: "true",
  SPIDER_APPROVED_HOSTS: "example.org",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  BROWSER_RUN_API_TOKEN: "test-token-value-that-is-long-enough",
  KV_MEMORY: {
    data: new Map(),
    async put(key, value) { this.data.set(key, value); },
    async get(key, type) {
      const value = this.data.get(key);
      if (value == null) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
  },
  SPIDER_QUEUE: { sent: [], async send(value) { this.sent.push(value); } },
};

test("Cloudflare Spider limits remain conservative and free-first", () => {
  assert.equal(CLOUDFLARE_SPIDER_LIMITS.maxPages, 10);
  assert.equal(CLOUDFLARE_SPIDER_LIMITS.maxDepth, 2);
  assert.equal(CLOUDFLARE_SPIDER_LIMITS.defaultRender, false);
  assert.equal(CLOUDFLARE_SPIDER_LIMITS.paidServices, false);
  assert.equal(CLOUDFLARE_SPIDER_LIMITS.externalActions, false);
});

test("validates exact allowlisted hostname and produces ceoai-spider/1 envelope", () => {
  const result = validateCloudflareSpiderInput({
    url: "https://example.org/docs#section",
    page_limit: 7,
    depth: 2,
  }, baseEnv);
  assert.equal(result.accepted, true);
  assert.equal(result.request.protocol, "ceoai-spider/1");
  assert.equal(result.request.adapter_id, "spider");
  assert.equal(result.request.url, "https://example.org/docs");
  assert.equal(result.request.page_limit, 7);
  assert.equal(result.request.render, false);
  assert.equal(result.request.paid_services, false);
});

test("rejects unapproved hosts, private targets, credentials, and nonstandard ports", () => {
  for (const url of [
    "https://evil.example/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "https://user:pass@example.org/",
    "https://example.org:8443/",
    "file:///etc/passwd",
  ]) {
    assert.equal(validateCloudflareSpiderInput({ url }, baseEnv).accepted, false, url);
  }
});

test("enforces page and depth ceilings and blocks JS rendering unless explicitly enabled", () => {
  assert.deepEqual(validateCloudflareSpiderInput({ url: "https://example.org", page_limit: 11 }, baseEnv).errors, ["page-limit-out-of-range"]);
  assert.deepEqual(validateCloudflareSpiderInput({ url: "https://example.org", depth: 9 }, baseEnv).errors, ["depth-out-of-range"]);
  assert.deepEqual(
    validateCloudflareSpiderInput({ url: "https://example.org", render: true }, baseEnv).errors,
    ["javascript-rendering-not-enabled"]
  );
  assert.equal(
    validateCloudflareSpiderInput({ url: "https://example.org", render: true }, {
      ...baseEnv, SPIDER_RENDER_JS_ENABLED: "true"
    }).request.render,
    true
  );
});

test("queues a bounded job and persists owner-scoped pending state", async () => {
  const env = structuredClone({
    SPIDER_CLOUDFLARE_ENABLED: baseEnv.SPIDER_CLOUDFLARE_ENABLED,
    SPIDER_APPROVED_HOSTS: baseEnv.SPIDER_APPROVED_HOSTS,
    CLOUDFLARE_ACCOUNT_ID: baseEnv.CLOUDFLARE_ACCOUNT_ID,
    BROWSER_RUN_API_TOKEN: baseEnv.BROWSER_RUN_API_TOKEN,
  });
  env.KV_MEMORY = {
    data: new Map(),
    async put(k, v) { this.data.set(k, v); },
    async get(k, type) { const v = this.data.get(k); return v == null ? null : (type === "json" ? JSON.parse(v) : v); },
  };
  env.SPIDER_QUEUE = { sent: [], async send(v) { this.sent.push(v); } };
  const result = await enqueueCloudflareSpiderJob(env, {
    job_id: "spider_job_001",
    url: "https://example.org/docs",
    page_limit: 4,
  }, "session-owner-1");
  assert.equal(result.accepted, true);
  assert.equal(result.status, 202);
  assert.equal(env.SPIDER_QUEUE.sent.length, 1);
  assert.equal(env.SPIDER_QUEUE.sent[0].protocol, "ceoai-spider/1");
  assert.match(result.job.job_id, /^spider_[a-f0-9-]{36}$/i);
  assert.equal(env.SPIDER_QUEUE.sent[0].job_id, result.job.job_id);
  assert.equal((await env.KV_MEMORY.get(`spider:job:${result.job.job_id}`, "json")).owner_session, "session-owner-1");
});

test("fails closed when queue, account token, or explicit enable gate is missing", async () => {
  assert.equal((await enqueueCloudflareSpiderJob({ ...baseEnv, SPIDER_CLOUDFLARE_ENABLED: "false" }, { url: "https://example.org" }, "s")).error, "spider-cloudflare-disabled");
  assert.equal((await enqueueCloudflareSpiderJob({ ...baseEnv, SPIDER_QUEUE: null }, { url: "https://example.org" }, "s")).error, "spider-queue-not-configured");
  assert.equal((await enqueueCloudflareSpiderJob({ ...baseEnv, BROWSER_RUN_API_TOKEN: "" }, { url: "https://example.org" }, "s")).error, "browser-run-not-configured");
});

test("queue consumer starts only allowlisted jobs and stores Browser Run job id", async () => {
  const env = {
    ...baseEnv,
    KV_MEMORY: {
      data: new Map([["spider:job:spider_job_002", JSON.stringify({
        protocol: "ceoai-spider/1", job_id: "spider_job_002", owner_session: "owner",
        status: "queued", hostname: "example.org", source_url: "https://example.org/",
        page_limit: 5, depth: 1, render: false,
      })]]),
      async put(k, v) { this.data.set(k, v); },
      async get(k, type) { const v = this.data.get(k); return v == null ? null : (type === "json" ? JSON.parse(v) : v); },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /browser-run\/crawl$/);
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.render, false);
    assert.equal(body.limit, 5);
    return Response.json({ success: true, result: "cf-job-123" });
  };
  const message = {
    body: { protocol: "ceoai-spider/1", job_id: "spider_job_002", owner_session: "owner",
      url: "https://example.org/", hostname: "example.org", page_limit: 5, depth: 1, render: false },
    acked: false, retried: false,
    ack() { this.acked = true; },
    retry() { this.retried = true; },
  };
  try {
    await processCloudflareSpiderQueue({ messages: [message] }, env);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(message.acked, true);
  const stored = await env.KV_MEMORY.get("spider:job:spider_job_002", "json");
  assert.equal(stored.status, "running");
  assert.equal(stored.cloudflare_job_id, "cf-job-123");
});

test("polling is owner-scoped and returns queued state without leaking other sessions", async () => {
  const env = {
    KV_MEMORY: {
      async get(key, type) {
        if (key !== "spider:job:spider_job_003") return null;
        const value = { job_id: "spider_job_003", owner_session: "owner-a", status: "queued" };
        return type === "json" ? value : JSON.stringify(value);
      },
    },
  };
  assert.equal((await getCloudflareSpiderJob(env, "spider_job_003", "owner-b")).status, 404);
  const owned = await getCloudflareSpiderJob(env, "spider_job_003", "owner-a");
  assert.equal(owned.status, 202);
  assert.equal(owned.body.job.status, "queued");
});

test("queue consumer enforces five crawl jobs per UTC day", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const data = new Map([
    [`spider:job:spider_job_005`, JSON.stringify({
      job_id: "spider_job_005", owner_session: "owner", status: "queued",
      hostname: "example.org", source_url: "https://example.org/", page_limit: 5, depth: 1, render: false,
    })],
    [`spider:daily:${day}`, "5"],
  ]);
  const env = {
    ...baseEnv,
    KV_MEMORY: {
      data,
      async put(k, v) { this.data.set(k, v); },
      async get(k, type) {
        const v = this.data.get(k);
        if (v == null) return null;
        return type === "json" ? JSON.parse(v) : v;
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("must-not-call-browser-run"); };
  const message = {
    body: { protocol: "ceoai-spider/1", job_id: "spider_job_005", owner_session: "owner",
      url: "https://example.org/", hostname: "example.org", page_limit: 5, depth: 1, render: false },
    acked: false, ack() { this.acked = true; }, retry() {},
  };
  try { await processCloudflareSpiderQueue({ messages: [message] }, env); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(message.acked, true);
  const stored = await env.KV_MEMORY.get("spider:job:spider_job_005", "json");
  assert.equal(stored.status, "daily_free_limit_reached");
});

test("normalizes only completed same-host pages into Spider protocol records", async () => {
  const result = await normalizeBrowserRunRecords({
    records: [
      { url: "https://example.org/a", status: "completed", markdown: "# Page A",
        metadata: { status: 200, title: "Page A" } },
      { url: "https://example.org/private", status: "disallowed", markdown: "blocked",
        metadata: { status: 0 } },
      { url: "https://outside.example/a", status: "completed", markdown: "external",
        metadata: { status: 200 } },
    ],
  }, { hostname: "example.org", page_limit: 10 });
  assert.equal(result.records.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.records[0].robots_allowed, true);
  assert.equal(result.records[0].extractor, "cloudflare-browser-run/markdown");
  assert.match(result.records[0].content_hash, /^[a-f0-9]{64}$/);
});

test("completed Browser Run results become owner-scoped ceoai-spider/1 records", async () => {
  const job = {
    protocol: "ceoai-spider/1",
    job_id: "spider_job_006",
    owner_session: "owner",
    hostname: "example.org",
    status: "running",
    cloudflare_job_id: "cloudflare-id-1",
    page_limit: 5,
    render: false,
  };
  const data = new Map([["spider:job:spider_job_006", JSON.stringify(job)]]);
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    BROWSER_RUN_API_TOKEN: "test-token-value-that-is-long-enough",
    KV_MEMORY: {
      data,
      async put(k, v) { this.data.set(k, v); },
      async get(k, type) {
        const v = this.data.get(k);
        return v == null ? null : (type === "json" ? JSON.parse(v) : v);
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /cloudflare-id-1\?limit=10$/);
    return Response.json({
      success: true,
      result: {
        status: "completed", total: 2, finished: 2, browserSecondsUsed: 3,
        records: [
          { url: "https://example.org/a", status: "completed", markdown: "# A",
            metadata: { status: 200, title: "A" } },
          { url: "https://example.org/blocked", status: "disallowed", markdown: "",
            metadata: { status: 0 } },
        ],
      },
    });
  };
  try {
    const result = await getCloudflareSpiderJob(env, "spider_job_006", "owner");
    assert.equal(result.status, 200);
    assert.equal(result.body.job.status, "completed");
    assert.equal("owner_session" in result.body.job, false);
    assert.equal("cloudflare_job_id" in result.body.job, false);
    assert.equal(result.body.job.result.protocol, "ceoai-spider/1");
    assert.equal(result.body.job.result.execution.engine, "cloudflare-browser-run");
    assert.equal(result.body.job.result.records.length, 1);
    assert.equal(result.body.job.result.records[0].robots_allowed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP adapter enforces streaming request cap without Content-Length", async () => {
  const oversized = new Request("https://ceoai.dev/api/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.org/", filler: "x".repeat(9_000) }),
  });
  const response = await handleCloudflareSpiderRequest(oversized, baseEnv, "session");
  assert.equal(response.status, 413);
  const data = await response.json();
  assert.equal(data.error, "request-too-large");
});
