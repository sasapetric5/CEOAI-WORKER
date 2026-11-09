import test from "node:test";
import assert from "node:assert/strict";
import { SpiderJobLedgerDO } from "../src/durable-objects/spider-job-ledger-do.mjs";
import { createSpiderQueueHandler, enqueueSpiderCrawl, readSpiderResult } from "../src/integrations/spider-queue.mjs";

const id = "123e4567-e89b-42d3-a456-426614174000";
const browserId = "crawl_job_12345678";
const now = () => 1_798_000_000_000;

function makeStorage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async transaction(fn) {
      const staged = new Map(values);
      const result = await fn({
        async get(key) { return staged.get(key); },
        async put(key, value) { staged.set(key, structuredClone(value)); },
      });
      values.clear();
      for (const [key, value] of staged) values.set(key, value);
      return result;
    },
    async setAlarm(value) { this.alarmAt = value; },
    async deleteAll() { values.clear(); },
  };
}

function makeLedgerNamespace() {
  const contexts = new Map();
  return {
    idFromName(name) { return name; },
    get(name) {
      if (!contexts.has(name)) contexts.set(name, { storage: makeStorage() });
      const ctx = contexts.get(name);
      return {
        async fetch(url, init) {
          return new SpiderJobLedgerDO(ctx).fetch(new Request(url, init));
        },
      };
    },
    contexts,
  };
}

function makeMessage(body) {
  const calls = [];
  return {
    body, calls,
    ack() { calls.push("ack"); },
    retry(options) { calls.push({ retry: options }); },
  };
}

function setup(createCrawler, sharedLedger = makeLedgerNamespace()) {
  const sent = [];
  const stored = new Map();
  const env = {
    SPIDER_QUEUE: { async send(body, options) { sent.push({ body, options }); } },
    SPIDER_LEDGER: sharedLedger,
    SPIDER_BROWSER_RUN_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    SPIDER_BROWSER_RUN_TOKEN: "test-token",
    KV_MEMORY: { async put(key, value, options) { stored.set(key, { value, options }); } },
  };
  return { env, sent, stored, ledger: sharedLedger, handler: createSpiderQueueHandler({ createCrawler, now }) };
}

test("Spider results can only be read from the authenticated app namespace", async () => {
  const ns = makeLedgerNamespace();
  const jobId = "123e4567-e89b-42d3-a456-426614174020";
  const appId = "CONTENTCRAFT-APP";
  const stub = ns.get("job:" + appId + ":" + jobId);
  const post = (path, body) => stub.fetch(new Request("https://ledger.test" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  })).then(response => response.json());
  await post("/job/claim-start", { appId, id: jobId, url: "https://docs.example.com/", pageLimit: 1, depth: 0, now: now() });
  await post("/job/mark-running", { appId, id: jobId, browserJobId: browserId, now: now() });
  const resultKey = "spider:result:" + appId + ":" + jobId;
  await post("/job/mark-complete", { appId, id: jobId, resultKey, recordCount: 1, now: now() });
  const resultDoc = { appId, jobId, records: [{ url: "https://docs.example.com/" }] };
  const kv = { async get(key) { return key === resultKey ? JSON.stringify(resultDoc) : null; } };
  const env = { SPIDER_LEDGER: ns, KV_MEMORY: kv };
  const own = await readSpiderResult(env, { appId, jobId });
  assert.equal(own.ok, true);
  assert.equal(own.result.records.length, 1);
  const foreign = await readSpiderResult(env, { appId: "AIFORCE-APP", jobId });
  assert.deepEqual(foreign, { ok: false, code: "SPIDER_JOB_NOT_FOUND" });
  const invalid = await readSpiderResult(env, { appId: "UNKNOWN-APP", jobId });
  assert.deepEqual(invalid, { ok: false, code: "SPIDER_APP_NOT_ALLOWED" });
});

test("ledger claims a crawl once and never repeats an ambiguous Browser Run POST", async () => {
  const ctx = { storage: makeStorage() };
  const ledger = new SpiderJobLedgerDO(ctx);
  const call = (path, input) => ledger.fetch(new Request("https://ledger.test" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  })).then(response => response.json());
  const job = { appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/", pageLimit: 10, depth: 1, now: now() };
  const first = await call("/job/claim-start", job);
  const duplicate = await call("/job/claim-start", job);
  assert.equal(first.claimed, true);
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.state.status, "starting");
  const payloadConflict = await call("/job/claim-start", {
    ...job, url: "https://other.example.com/", now: now() + 1,
  });
  assert.equal(payloadConflict.claimed, false);
  assert.equal(payloadConflict.conflict, true);
  const stale = await call("/job/claim-start", { ...job, now: now() + 120_001 });
  assert.equal(stale.state.status, "start_unknown");
  const afterUnknown = await call("/job/claim-start", { ...job, now: now() + 180_000 });
  assert.equal(afterUnknown.claimed, false);
  assert.equal(afterUnknown.state.status, "start_unknown");
});

test("Spider ledger prevents cross-application reads and state transitions", async () => {
  const ns = makeLedgerNamespace();
  const appA = ns.get("job:CONTENTCRAFT-APP:" + id);
  const appB = ns.get("job:AIFORCE-APP:" + id);
  const post = (stub, path, body) => stub.fetch(new Request("https://ledger.test" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).then(async response => ({ status: response.status, body: await response.json() }));
  const job = { appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/", pageLimit: 10, depth: 1, now: now() };
  const created = await post(appA, "/job/claim-start", job);
  assert.equal(created.body.claimed, true);
  const foreignRead = await post(appA, "/job/get", { appId: "AIFORCE-APP", id });
  assert.equal(foreignRead.body.state, null);
  const foreignMutation = await post(appA, "/job/mark-failed", {
    appId: "AIFORCE-APP", id, code: "ATTACK_ATTEMPT", now: now(),
  });
  assert.equal(foreignMutation.status, 409);
  assert.equal(foreignMutation.body.code, "JOB_NOT_FOUND");
  const ownRead = await post(appA, "/job/get", { appId: "CONTENTCRAFT-APP", id });
  assert.equal(ownRead.body.state.status, "starting");
  const otherTenantRead = await post(appB, "/job/get", { appId: "AIFORCE-APP", id });
  assert.equal(otherTenantRead.body.state, null);
});

test("daily account quota is atomic and duplicate job claims do not consume a second slot", async () => {
  const ns = makeLedgerNamespace();
  const stub = ns.get("quota:2026-11-05");
  const call = input => stub.fetch(new Request("https://ledger.test/quota/claim", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  })).then(response => response.json());
  const first = await call({ appId: "GLOBAL", date: "2026-11-05", id, limit: 5, now: now() });
  const duplicate = await call({ appId: "GLOBAL", date: "2026-11-05", id, limit: 5, now: now() });
  assert.equal(first.allowed, true);
  assert.equal(duplicate.duplicate, true);
  for (let i = 1; i < 5; i++) {
    const otherId = "123e4567-e89b-42d3-a456-42661417400" + i;
    assert.equal((await call({ appId: "GLOBAL", date: "2026-11-05", id: otherId, limit: 5, now: now() })).allowed, true);
  }
  const sixth = await call({ appId: "GLOBAL", date: "2026-11-05", id: "123e4567-e89b-42d3-a456-426614174099", limit: 5, now: now() });
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.count, 5);
});

test("daily Spider quotas are isolated and enforced independently for all three apps", async () => {
  const ns = makeLedgerNamespace();
  const date = "2026-11-05";
  const claim = (appId, jobId, limit) => ns.get("quota:app:" + appId + ":" + date).fetch(new Request("https://ledger.test/quota/claim", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, date, id: jobId, limit, now: now() })
  })).then(response => response.json());
  const cases = [
    { appId: "CONTENTCRAFT-APP", limit: 3, ids: [
      "123e4567-e89b-42d3-a456-426614174010",
      "123e4567-e89b-42d3-a456-426614174011",
      "123e4567-e89b-42d3-a456-426614174012",
      "123e4567-e89b-42d3-a456-426614174013"
    ]},
    { appId: "AIFORCE-APP", limit: 2, ids: [
      "223e4567-e89b-42d3-a456-426614174010",
      "223e4567-e89b-42d3-a456-426614174011",
      "223e4567-e89b-42d3-a456-426614174012"
    ]},
    { appId: "RANKGEO-APP", limit: 2, ids: [
      "323e4567-e89b-42d3-a456-426614174010",
      "323e4567-e89b-42d3-a456-426614174011",
      "323e4567-e89b-42d3-a456-426614174012"
    ]}
  ];
  for (const entry of cases) {
    for (let i = 0; i < entry.limit; i++) {
      const result = await claim(entry.appId, entry.ids[i], entry.limit);
      assert.equal(result.allowed, true, entry.appId + " slot " + i);
    }
    const blocked = await claim(entry.appId, entry.ids[entry.limit], entry.limit);
    assert.equal(blocked.allowed, false, entry.appId + " must enforce its own limit");
    assert.equal(blocked.count, entry.limit, entry.appId + " quota count");
  }
  // The same job ID can be claimed independently in each app namespace.
  const isolatedNs = makeLedgerNamespace();
  const sharedId = "423e4567-e89b-42d3-a456-426614174010";
  for (const appId of ["CONTENTCRAFT-APP", "AIFORCE-APP", "RANKGEO-APP"]) {
    const response = await isolatedNs.get("quota:app:" + appId + ":2026-11-06").fetch(new Request("https://ledger.test/quota/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, date: "2026-11-06", id: sharedId, limit: 2, now: now() })
    }));
    const result = await response.json();
    assert.equal(result.allowed, true, appId + " must have an independent quota namespace");
    assert.equal(result.count, 1);
  }
});

test("producer validates and publishes a bounded HTTPS job", async () => {
  const sent = [];
  const env = { SPIDER_QUEUE: { async send(body) { sent.push(body); } } };
  const result = await enqueueSpiderCrawl(env, { appId: "CONTENTCRAFT-APP", url: "https://docs.example.com/start?token=secret", jobId: id });
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://docs.example.com/start");
  assert.equal(sent[0].id, id);
  assert.equal((await enqueueSpiderCrawl(env, { appId: "CONTENTCRAFT-APP", url: "http://127.0.0.1" })).code, "CRAWL_URL_REJECTED");
  assert.equal(sent.length, 1);
});

test("start message creates one Browser Run job and schedules polling", async () => {
  let starts = 0;
  const crawler = {
    async startCrawl() { starts++; return { ok: true, jobId: browserId }; },
    async getStatus() { return { ok: true, status: "running" }; },
    async getResults() { throw new Error("not called"); },
  };
  const { env, sent, handler } = setup(() => crawler);
  const message = makeMessage({ version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/", pageLimit: 10, depth: 1, queuedAt: now() });
  await handler({ messages: [message] }, env);
  assert.equal(starts, 1);
  assert.equal(message.calls[0], "ack");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.kind, "poll");
  assert.equal(sent[0].options.delaySeconds, 60);

  const duplicate = makeMessage(message.body);
  await handler({ messages: [duplicate] }, env);
  assert.equal(starts, 1);
  assert.equal(duplicate.calls[0], "ack");
  assert.equal(sent.length, 2);
});

test("polling stores bounded untrusted records and marks the job complete idempotently", async () => {
  const crawler = {
    async startCrawl() { return { ok: true, jobId: browserId }; },
    async getStatus() { return { ok: true, status: "completed", total: 1, finished: 1 }; },
    async getResults() { return { ok: true, status: "completed", records: [{ url: "https://docs.example.com/", markdown: "# docs" }] }; },
  };
  const { env, sent, stored, handler } = setup(() => crawler);
  const start = makeMessage({ version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/", pageLimit: 10, depth: 1, queuedAt: now() });
  await handler({ messages: [start] }, env);
  const poll = makeMessage({ version: 1, kind: "poll", appId: "CONTENTCRAFT-APP", id, attempt: 0 });
  await handler({ messages: [poll] }, env);
  assert.equal(poll.calls[0], "ack");
  const saved = stored.get("spider:result:CONTENTCRAFT-APP:" + id);
  assert.ok(saved);
  assert.equal(saved.options.expirationTtl, 7 * 24 * 60 * 60);
  assert.equal(JSON.parse(saved.value).trust, "untrusted_reference");

  const duplicate = makeMessage(poll.body);
  await handler({ messages: [duplicate] }, env);
  assert.equal(duplicate.calls[0], "ack");
  assert.equal(stored.size, 1);
});

test("missing Browser Run credentials fail closed without calling the provider", async () => {
  let starts = 0;
  const crawler = { async startCrawl() { starts++; return { ok: true, jobId: browserId }; } };
  const { env, handler } = setup(() => crawler);
  delete env.SPIDER_BROWSER_RUN_TOKEN;
  const message = makeMessage({ version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/", pageLimit: 10, depth: 1, queuedAt: now() });
  await handler({ messages: [message] }, env);
  assert.equal(starts, 0);
  assert.equal(message.calls[0], "ack");
});

test("uncertain Browser Run start is not automatically retried", async () => {
  let starts = 0;
  const crawler = { async startCrawl() { starts++; return { ok: false, code: "CRAWL_PROVIDER_UNAVAILABLE" }; } };
  const { env, handler } = setup(() => crawler);
  const message = makeMessage({ version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/", pageLimit: 10, depth: 1, queuedAt: now() });
  await handler({ messages: [message] }, env);
  assert.equal(starts, 1);
  assert.equal(message.calls[0], "ack");
  const duplicate = makeMessage(message.body);
  await handler({ messages: [duplicate] }, env);
  assert.equal(starts, 1);
  assert.equal(duplicate.calls[0], "ack");
});

test("malformed queue messages are retried for eventual DLQ inspection and never reach Browser Run", async () => {
  let calls = 0;
  const { env, handler } = setup(() => ({ async startCrawl() { calls++; } }));
  const message = makeMessage({ version: 99, kind: "start", id, url: "https://docs.example.com/", pageLimit: 1000 });
  await handler({ messages: [message] }, env);
  assert.equal(calls, 0);
  assert.deepEqual(message.calls[0], { retry: { delaySeconds: 60 } });
});


test("combined Spider quota enforces global cap and preserves duplicate claims", async () => {
  const ns = makeLedgerNamespace();
  const stub = ns.get("quota:global:2026-11-08");
  const call = (appId, jobId) => stub.fetch(new Request("https://ledger.test/quota/claim-combined", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: "GLOBAL", quotaAppId: appId, date: "2026-11-08", id: jobId, appLimit: appId === "CONTENTCRAFT-APP" ? 3 : 2, globalLimit: 5, now: now() }),
  })).then(response => response.json());
  const jobs = [["CONTENTCRAFT-APP","123e4567-e89b-42d3-a456-426614174030"],["AIFORCE-APP","223e4567-e89b-42d3-a456-426614174030"],["RANKGEO-APP","323e4567-e89b-42d3-a456-426614174030"],["CONTENTCRAFT-APP","123e4567-e89b-42d3-a456-426614174031"],["AIFORCE-APP","223e4567-e89b-42d3-a456-426614174031"]];
  for (const [app, job] of jobs) assert.equal((await call(app, job)).allowed, true);
  const blocked = await call("RANKGEO-APP", "323e4567-e89b-42d3-a456-426614174031");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "GLOBAL_DAILY_LIMIT_REACHED");
  const duplicate = await call("CONTENTCRAFT-APP", jobs[0][1]);
  assert.equal(duplicate.allowed, true);
  assert.equal(duplicate.duplicate, true);
  const quota = ns.contexts.get("quota:global:2026-11-08").storage.values.get("quota");
  assert.equal(quota.count, 5);
  assert.equal(quota.appCounts["CONTENTCRAFT-APP"], 2);
  assert.equal(quota.appCounts["AIFORCE-APP"], 2);
  assert.equal(quota.appCounts["RANKGEO-APP"], 1);
});
test("daily Browser Run budget is shared across separate app consumers", async () => {
  const sharedLedger = makeLedgerNamespace();
  let starts = 0;
  const createCrawler = () => ({
    async startCrawl() { starts++; return { ok: true, jobId: browserId }; },
  });
  const appA = setup(createCrawler, sharedLedger);
  const appB = setup(createCrawler, sharedLedger);
  for (let i = 0; i < 5; i++) {
    const jobId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const message = makeMessage({
      version: 1, kind: "start", appId: i % 2 === 0 ? "CONTENTCRAFT-APP" : "AIFORCE-APP", id: jobId, url: "https://docs.example.com/",
      pageLimit: 10, depth: 1, queuedAt: now(),
    });
    const current = i % 2 === 0 ? appA : appB;
    await current.handler({ messages: [message] }, current.env);
    assert.equal(message.calls[0], "ack");
  }
  const sixth = makeMessage({
    version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id: "00000000-0000-4000-8000-000000000099",
    url: "https://docs.example.com/", pageLimit: 10, depth: 1, queuedAt: now(),
  });
  await appB.handler({ messages: [sixth] }, appB.env);
  assert.equal(sixth.calls[0], "ack");
  assert.equal(starts, 5);
  const quotaContext = [...sharedLedger.contexts.entries()].find(([name]) => name.startsWith("quota:global:"));
  assert.ok(quotaContext);
  assert.equal(quotaContext[1].storage.values.get("quota").count, 5);
});

test("missing Browser Run configuration does not consume a daily quota slot", async () => {
  const { env, ledger, handler } = setup(() => ({
    async startCrawl() { throw new Error("must not be called"); },
  }));
  delete env.SPIDER_BROWSER_RUN_TOKEN;
  const message = makeMessage({
    version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/",
    pageLimit: 10, depth: 1, queuedAt: now(),
  });
  await handler({ messages: [message] }, env);
  assert.equal(message.calls[0], "ack");
  assert.equal([...ledger.contexts.keys()].some(name => name.startsWith("quota:")), false);
});

test("reusing a request ID with a different URL never starts another crawl", async () => {
  let starts = 0;
  const crawler = {
    async startCrawl() { starts++; return { ok: true, jobId: browserId }; },
  };
  const { env, handler } = setup(() => crawler);
  const first = makeMessage({
    version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/",
    pageLimit: 10, depth: 1, queuedAt: now(),
  });
  await handler({ messages: [first] }, env);
  const reused = makeMessage({
    version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://different.example.com/",
    pageLimit: 10, depth: 1, queuedAt: now(),
  });
  await handler({ messages: [reused] }, env);
  assert.equal(starts, 1);
  assert.equal(reused.calls[0], "ack");
});

test("combined Spider quota migrates legacy global and per-app counters and preserves legacy IDs", async () => {
  const ns = makeLedgerNamespace();
  const date = "2026-11-08";
  const global = ns.get("quota:" + date);
  const app = ns.get("quota:app:CONTENTCRAFT-APP:" + date);
  const post = (stub, path, body) => stub.fetch(new Request("https://ledger.test" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).then(response => response.json());
  const globalIds = ["123e4567-e89b-42d3-a456-426614174050", "123e4567-e89b-42d3-a456-426614174051"];
  const appIds = ["223e4567-e89b-42d3-a456-426614174050", "223e4567-e89b-42d3-a456-426614174051", "223e4567-e89b-42d3-a456-426614174052"];
  for (const jobId of globalIds) await post(global, "/quota/claim", { appId: "GLOBAL", date, id: jobId, limit: 5, now: now() });
  for (const jobId of appIds) await post(app, "/quota/claim", { appId: "CONTENTCRAFT-APP", date, id: jobId, limit: 3, now: now() });
  const legacyGlobal = await post(global, "/quota/get", { appId: "GLOBAL", date });
  const legacyApp = await post(app, "/quota/get", { appId: "CONTENTCRAFT-APP", date });
  const combined = ns.get("quota:global:" + date);
  const claim = (jobId, g = legacyGlobal, a = legacyApp) => post(combined, "/quota/claim-combined", {
    appId: "GLOBAL", quotaAppId: "CONTENTCRAFT-APP", date, id: jobId,
    appLimit: 3, globalLimit: 5, now: now(),
    legacyGlobalCount: g.count, legacyGlobalJobIds: g.jobIds,
    legacyAppCount: a.count, legacyAppJobIds: a.jobIds,
  });
  const appBlocked = await claim("323e4567-e89b-42d3-a456-426614174050");
  assert.equal(appBlocked.allowed, false);
  assert.equal(appBlocked.reason, "APP_DAILY_LIMIT_REACHED");
  const duplicate = await claim(appIds[0]);
  assert.equal(duplicate.allowed, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.appCount, 3);
  const globalAtCap = { count: 5, jobIds: [...globalIds, "323e4567-e89b-42d3-a456-426614174051", "323e4567-e89b-42d3-a456-426614174052", "323e4567-e89b-42d3-a456-426614174053"] };
  const globalBlocked = await claim("423e4567-e89b-42d3-a456-426614174050", globalAtCap, legacyApp);
  assert.equal(globalBlocked.allowed, false);
  assert.equal(globalBlocked.reason, "GLOBAL_DAILY_LIMIT_REACHED");
});
