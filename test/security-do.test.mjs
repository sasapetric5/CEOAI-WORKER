import test from "node:test";
import assert from "node:assert/strict";
import { SecurityOrchestratorDO } from "../src/durable-objects/security-do.mjs";

function makeStore() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async transaction(callback) {
      return callback({
        async get(key) { return values.get(key); },
        async put(key, value) { values.set(key, value); },
        async delete(key) { values.delete(key); },
      });
    },
    async list({ prefix, limit }) {
      return [...values.entries()].filter(([key]) => key.startsWith(prefix)).slice(0, limit);
    },
    async delete(keys) { for (const key of keys) values.delete(key); },
  };
}

function makeRequest(payload) {
  return new Request("https://do/nonce/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("Durable Object atomically accepts a nonce only once", async () => {
  const storage = makeStore();
  const durable = new SecurityOrchestratorDO({ storage });
  const payload = { appId: "CONTENTCRAFT-APP", nonce: "nonce_do_test_123456789", timestamp: Math.floor(Date.now() / 1000) };
  const first = await durable.fetch(makeRequest(payload));
  const replay = await durable.fetch(makeRequest(payload));
  assert.equal(first.status, 200);
  assert.equal(replay.status, 409);
});

test("Durable Object rejects malformed and expired nonce requests", async () => {
  const durable = new SecurityOrchestratorDO({ storage: makeStore() });
  const malformed = await durable.fetch(makeRequest({ appId: "bad app", nonce: "short", timestamp: 1 }));
  const expired = await durable.fetch(makeRequest({
    appId: "CONTENTCRAFT-APP",
    nonce: "nonce_do_expired_123456",
    timestamp: Math.floor(Date.now() / 1000) - 600,
  }));
  assert.equal(malformed.status, 400);
  assert.equal(expired.status, 401);
});

test("Durable Object returns 404 for unsupported routes", async () => {
  const durable = new SecurityOrchestratorDO({ storage: makeStore() });
  const response = await durable.fetch(new Request("https://do/other", { method: "POST" }));
  assert.equal(response.status, 404);
});

test("session quota is atomic, capped at 1000 per day, and resets on the next UTC day", async () => {
  const durable = new SecurityOrchestratorDO({ storage: makeStore() });
  const claim = (date) => durable.fetch(new Request("https://do/session/claim", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, now: Date.now() }),
  }));
  for (let i = 0; i < 1000; i++) assert.equal((await claim("2026-11-08")).status, 200);
  assert.equal((await claim("2026-11-08")).status, 429);
  assert.equal((await claim("2026-11-09")).status, 200);
});

test("Durable Object permits nonce reuse only after the replay retention window expires", async () => {
  const storage = makeStore();
  const durable = new SecurityOrchestratorDO({ storage });
  const appId = "CONTENTCRAFT-APP";
  const nonce = "nonce_do_expiry_123456789";
  storage.values.set("nonce:" + appId + ":" + nonce, Math.floor(Date.now() / 1000) - 601);
  const response = await durable.fetch(makeRequest({
    appId,
    nonce,
    timestamp: Math.floor(Date.now() / 1000),
  }));
  assert.equal(response.status, 200);
  assert.equal(storage.values.get("nonce:" + appId + ":" + nonce) > Math.floor(Date.now() / 1000) - 2, true);
});

test("Durable Object rejects a nonce record still inside its replay retention window", async () => {
  const storage = makeStore();
  const durable = new SecurityOrchestratorDO({ storage });
  const appId = "CONTENTCRAFT-APP";
  const nonce = "nonce_do_live_123456789";
  storage.values.set("nonce:" + appId + ":" + nonce, Math.floor(Date.now() / 1000) - 30);
  const response = await durable.fetch(makeRequest({
    appId,
    nonce,
    timestamp: Math.floor(Date.now() / 1000),
  }));
  assert.equal(response.status, 409);
});

import { createCloudflareTufMetadataStore } from "../src/agent/cloudflare-tuf-metadata-store.mjs";

test("TUF metadata cache persists atomically with monotonic root version and CAS revision", async () => {
  const storage = makeStore();
  const durable = new SecurityOrchestratorDO({ storage });
  const namespace = {
    idFromName(name) { assert.equal(name, "sigstore-tuf-global"); return name; },
    get(id) { return { fetch: (input, init) => durable.fetch(new Request(input, init)) }; },
  };
  const cacheStore = createCloudflareTufMetadataStore(namespace);
  const empty = await cacheStore.load();
  assert.equal(empty.revision, 0);
  const cache = {
    "root.json": btoa("root-v1"),
    "root_history/16.root.json": btoa("root-v16"),
    "root_history/17.root.json": btoa("root-v17"),
    "timestamp.json": btoa("timestamp-v1"),
  };
  const committed = await cacheStore.commit({ expectedRevision: 0, rootVersion: 16, cache });
  assert.equal(committed.revision, 1);
  assert.equal((await cacheStore.load()).cache["root.json"], cache["root.json"]);
  assert.equal((await cacheStore.load()).cache["root_history/17.root.json"], cache["root_history/17.root.json"]);
  await assert.rejects(() => cacheStore.commit({ expectedRevision: 0, rootVersion: 16, cache }), /TUF_CACHE_REVISION_CONFLICT/);
  await assert.rejects(() => cacheStore.commit({ expectedRevision: 1, rootVersion: 15, cache }), /TUF_ROOT_ROLLBACK_REJECTED/);
  assert.equal((await cacheStore.load()).rootVersion, 16);
});

test("TUF metadata cache rejects unsafe names, missing root and malformed base64", async () => {
  const storage = makeStore();
  const durable = new SecurityOrchestratorDO({ storage });
  const namespace = { idFromName: name => name, get: () => ({ fetch: (input, init) => durable.fetch(new Request(input, init)) }) };
  const cacheStore = createCloudflareTufMetadataStore(namespace);
  await assert.rejects(() => cacheStore.commit({ expectedRevision: 0, rootVersion: 1, cache: { "../evil.json": btoa("x") } }), /INVALID_TUF_CACHE/);
  await assert.rejects(() => cacheStore.commit({ expectedRevision: 0, rootVersion: 1, cache: { "timestamp.json": btoa("x") } }), /INVALID_TUF_CACHE/);
  await assert.rejects(() => cacheStore.commit({ expectedRevision: 0, rootVersion: 1, cache: { "root.json": "not base64!" } }), /INVALID_TUF_CACHE/);
  assert.equal((await cacheStore.load()).revision, 0);
});
