import test from "node:test";
import assert from "node:assert/strict";
import { SpiderJobLedgerDO } from "../src/durable-objects/spider-job-ledger-do.mjs";

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

function makeLedger() {
  const ctx = { storage: makeStorage() };
  const durable = new SpiderJobLedgerDO(ctx);
  return async (date, quotaAppId, id) => {
    const response = await durable.fetch(new Request("https://ledger.test/quota/claim-combined", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: "GLOBAL",
        quotaAppId,
        date,
        id,
        appLimit: { "CONTENTCRAFT-APP": 3, "AIFORCE-APP": 2, "RANKGEO-APP": 2 }[quotaAppId],
        globalLimit: 5,
        now: Date.UTC(2026, 10, 9),
      }),
    }));
    return response.json();
  };
}

const jobId = n => `123e4567-e89b-42d3-a456-${String(n).padStart(4, "0")}-123456789012`;

test("concurrent app claims cannot exceed the shared global or per-app daily limits", async () => {
  const claim = makeLedger();
  const requests = [
    ...Array.from({ length: 6 }, (_, i) => ["CONTENTCRAFT-APP", i + 1]),
    ...Array.from({ length: 4 }, (_, i) => ["AIFORCE-APP", i + 20]),
    ...Array.from({ length: 4 }, (_, i) => ["RANKGEO-APP", i + 40]),
  ];
  const results = await Promise.all(requests.map(([app, n]) => claim("2026-11-09", app, jobId(n))));
  assert.equal(results.filter(result => result.allowed).length, 5);
  const acceptedByApp = new Map();
  for (let i = 0; i < requests.length; i++) {
    if (results[i].allowed) acceptedByApp.set(requests[i][0], (acceptedByApp.get(requests[i][0]) || 0) + 1);
  }
  assert.ok((acceptedByApp.get("CONTENTCRAFT-APP") || 0) <= 3);
  assert.ok((acceptedByApp.get("AIFORCE-APP") || 0) <= 2);
  assert.ok((acceptedByApp.get("RANKGEO-APP") || 0) <= 2);
});

test("a duplicate retry remains idempotently allowed after the global limit is reached", async () => {
  const claim = makeLedger();
  const accepted = [];
  for (let i = 0; i < 5; i++) {
    const app = i < 3 ? "CONTENTCRAFT-APP" : "AIFORCE-APP";
    const result = await claim("2026-11-09", app, jobId(i + 100));
    assert.equal(result.allowed, true);
    accepted.push([app, jobId(i + 100)]);
  }
  const [app, id] = accepted[0];
  const replay = await claim("2026-11-09", app, id);
  assert.equal(replay.allowed, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.count, 5);
});

test("UTC date rollover starts a fresh quota bucket without changing the previous day", async () => {
  const claim = makeLedger();
  const yesterday = await claim("2026-11-08", "CONTENTCRAFT-APP", jobId(201));
  const today = await claim("2026-11-09", "CONTENTCRAFT-APP", jobId(202));
  assert.equal(yesterday.allowed, true);
  assert.equal(today.allowed, true);
  assert.equal(yesterday.count, 1);
  assert.equal(today.count, 1);
});
