import test from "node:test";
import assert from "node:assert/strict";
import { SpiderJobLedgerDO } from "../src/durable-objects/spider-job-ledger-do.mjs";
import { createSpiderQueueHandler } from "../src/integrations/spider-queue.mjs";

const id = "123e4567-e89b-42d3-a456-426614174000";
const browserId = "crawl_job_12345678";
const nowValue = 1_798_000_000_000;
const now = () => nowValue;

function makeStorage() {
  const values = new Map();
  let tail = Promise.resolve();
  return {
    async get(key) { return values.get(key); },
    async transaction(fn) {
      const run = tail.then(async () => {
        const staged = new Map(values);
        const result = await fn({
          async get(key) { return staged.get(key); },
          async put(key, value) { staged.set(key, structuredClone(value)); },
        });
        values.clear();
        for (const [key, value] of staged) values.set(key, value);
        return result;
      });
      tail = run.catch(() => {});
      return run;
    },
    async setAlarm() {},
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
  };
}

function makeMessage(body) {
  const calls = [];
  return { body, calls, ack() { calls.push("ack"); }, retry(options) { calls.push({ retry: options }); } };
}

function makeEnvironment({ send, put = async () => {} } = {}) {
  return {
    SPIDER_QUEUE: { send },
    SPIDER_LEDGER: makeLedgerNamespace(),
    SPIDER_BROWSER_RUN_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    SPIDER_BROWSER_RUN_TOKEN: "test-token",
    KV_MEMORY: { put },
  };
}

const startBody = {
  version: 1, kind: "start", appId: "CONTENTCRAFT-APP", id, url: "https://docs.example.com/",
  pageLimit: 10, depth: 1, queuedAt: nowValue,
};

test("failed poll publication retries start delivery without duplicating Browser Run creation", async () => {
  let starts = 0;
  let sends = 0;
  const env = makeEnvironment({
    async send() {
      sends++;
      if (sends === 1) throw new Error("temporary queue publish failure");
    },
  });
  const handler = createSpiderQueueHandler({
    now,
    createCrawler: () => ({
      async startCrawl() { starts++; return { ok: true, jobId: browserId }; },
    }),
  });

  const firstDelivery = makeMessage(startBody);
  await handler({ messages: [firstDelivery] }, env);
  assert.deepEqual(firstDelivery.calls, [{ retry: { delaySeconds: 60 } }]);
  assert.equal(starts, 1);

  const retriedDelivery = makeMessage(startBody);
  await handler({ messages: [retriedDelivery] }, env);
  assert.deepEqual(retriedDelivery.calls, ["ack"]);
  assert.equal(starts, 1, "durable running state must prevent a second Browser Run POST");
  assert.equal(sends, 2);
});

test("temporary result-store failure retries polling and completes after storage recovers", async () => {
  let puts = 0;
  let statusCalls = 0;
  const stored = new Map();
  const env = makeEnvironment({
    async send() {},
    async put(key, value, options) {
      puts++;
      if (puts === 1) throw new Error("temporary KV outage");
      stored.set(key, { value, options });
    },
  });
  const handler = createSpiderQueueHandler({
    now,
    createCrawler: () => ({
      async startCrawl() { return { ok: true, jobId: browserId }; },
      async getStatus() { statusCalls++; return { ok: true, status: "completed", total: 1, finished: 1 }; },
      async getResults() { return { ok: true, status: "completed", records: [{ url: "https://docs.example.com/", markdown: "# docs" }] }; },
    }),
  });

  const start = makeMessage(startBody);
  await handler({ messages: [start] }, env);
  assert.deepEqual(start.calls, ["ack"]);

  const pollBody = { version: 1, kind: "poll", appId: "CONTENTCRAFT-APP", id, attempt: 0 };
  const firstPoll = makeMessage(pollBody);
  await handler({ messages: [firstPoll] }, env);
  assert.deepEqual(firstPoll.calls, [{ retry: { delaySeconds: 60 } }]);
  assert.equal(stored.size, 0);

  const secondPoll = makeMessage(pollBody);
  await handler({ messages: [secondPoll] }, env);
  assert.deepEqual(secondPoll.calls, ["ack"]);
  assert.equal(statusCalls, 2);
  assert.equal(stored.has("spider:result:CONTENTCRAFT-APP:" + id), true);

  const ledger = env.SPIDER_LEDGER.get("job:CONTENTCRAFT-APP:" + id);
  const response = await ledger.fetch("https://ledger.test/job/get", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: "CONTENTCRAFT-APP", id }),
  });
  const result = await response.json();
  assert.equal(result.state.status, "completed");
});
