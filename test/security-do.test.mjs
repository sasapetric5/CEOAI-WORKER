import test from "node:test";
import assert from "node:assert/strict";
import { SecurityOrchestratorDO } from "../src/durable-objects/security-do.mjs";

function makeStore() {
  const values = new Map();
  return {
    values,
    async transaction(callback) {
      return callback({
        async get(key) { return values.get(key); },
        async put(key, value) { values.set(key, value); },
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
