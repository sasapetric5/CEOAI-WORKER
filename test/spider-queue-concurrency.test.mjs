import test from "node:test";
import assert from "node:assert/strict";
import { SpiderJobLedgerDO } from "../src/durable-objects/spider-job-ledger-do.mjs";

function makeSerializedStorage() {
  const values = new Map();
  let tail = Promise.resolve();
  return {
    values,
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
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async setAlarm() {},
    async deleteAll() { values.clear(); },
  };
}

function makeLedger(storage) {
  const ledger = new SpiderJobLedgerDO({ storage });
  return async (path, input) => {
    const response = await ledger.fetch(new Request("https://ledger.test" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }));
    return { status: response.status, body: await response.json() };
  };
}

const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");

test("parallel daily quota claims never exceed the atomic five-job limit", async () => {
  const storage = makeSerializedStorage();
  const call = makeLedger(storage);
  const date = "2026-11-05";
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    call("/quota/claim", { date, id: uuid(i + 1), limit: 5, now: 1_798_000_000_000 })
  ));
  assert.equal(results.filter(x => x.body.allowed).length, 5);
  assert.equal(results.filter(x => x.body.allowed === false).length, 35);
  assert.equal((await storage.get("quota")).count, 5);
  assert.equal(new Set((await storage.get("quota")).jobIds).size, 5);
});

test("parallel duplicate quota claims for one job consume exactly one slot", async () => {
  const storage = makeSerializedStorage();
  const call = makeLedger(storage);
  const input = { date: "2026-11-05", id: uuid(1), limit: 5, now: 1_798_000_000_000 };
  const results = await Promise.all(Array.from({ length: 25 }, () => call("/quota/claim", input)));
  assert.equal(results.every(x => x.status === 200 && x.body.allowed), true);
  assert.equal(results.filter(x => x.body.duplicate === false).length, 1);
  assert.equal((await storage.get("quota")).count, 1);
});

test("parallel duplicate start deliveries create exactly one start lease", async () => {
  const storage = makeSerializedStorage();
  const call = makeLedger(storage);
  const input = {
    id: uuid(2), url: "https://docs.example.com/", pageLimit: 10,
    depth: 1, now: 1_798_000_000_000,
  };
  const results = await Promise.all(Array.from({ length: 25 }, () => call("/job/claim-start", input)));
  assert.equal(results.every(x => x.status === 200), true);
  assert.equal(results.filter(x => x.body.claimed === true).length, 1);
  assert.equal(results.filter(x => x.body.claimed === false).length, 24);
  assert.equal((await storage.get("state")).status, "starting");
});

test("parallel request-ID payload conflicts cannot replace the first accepted crawl", async () => {
  const storage = makeSerializedStorage();
  const call = makeLedger(storage);
  const base = {
    id: uuid(3), url: "https://docs.example.com/", pageLimit: 10,
    depth: 1, now: 1_798_000_000_000,
  };
  const results = await Promise.all([
    call("/job/claim-start", base),
    call("/job/claim-start", { ...base, url: "https://attacker.example/" }),
  ]);
  assert.equal(results.filter(x => x.body.claimed === true).length, 1);
  assert.equal(results.filter(x => x.body.conflict === true).length, 1);
  const state = await storage.get("state");
  assert.ok(["https://docs.example.com/", "https://attacker.example/"].includes(state.url));
  assert.equal(state.id, base.id);
});
