import test from "node:test";
import assert from "node:assert/strict";
import { createAppMemoryStore } from "../src/v5-modules/app-memory.mjs";

function memoryKV() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.get(key) ?? null; },
    async put(key, value, options) { data.set(key, value); assert.ok(options.expirationTtl > 0); },
    async delete(key) { data.delete(key); },
  };
}
const sessionA = "123e4567-e89b-42d3-a456-426614174000";
const sessionB = "123e4567-e89b-42d3-a456-426614174001";
const enabledPolicy = { enabled: true, memory: true };

test("app memory namespaces isolate ContentCraft, AI Force and RankGeo", async () => {
  const kv = memoryKV();
  const stores = ["CONTENTCRAFT-APP", "AIFORCE-APP"].map(appId =>
    createAppMemoryStore({ kv, appId, appPolicy: enabledPolicy })
  );
  await stores[0].write(sessionA, { history: [{ role: "user", content: "contentcraft-private" }] });
  await stores[1].write(sessionA, { history: [{ role: "user", content: "aiforce-private" }] });
  assert.match(stores[0].namespacePrefix, /CONTENTCRAFT-APP/);
  assert.match(stores[1].namespacePrefix, /AIFORCE-APP/);
  assert.equal((await stores[0].read(sessionA)).history[0].content, "contentcraft-private");
  assert.equal((await stores[1].read(sessionA)).history[0].content, "aiforce-private");
  assert.notEqual(stores[0].namespacePrefix, stores[1].namespacePrefix);
});

test("RankGeo memory namespace is prepared but disabled until activation", async () => {
  const kv = memoryKV();
  assert.throws(
    () => createAppMemoryStore({ kv, appId: "RANKGEO-APP", appPolicy: { enabled: false, memory: true } }),
    /APP_DISABLED/
  );
});

test("reset only deletes the bound app and session namespace", async () => {
  const kv = memoryKV();
  const contentCraft = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  const aiForce = createAppMemoryStore({ kv, appId: "AIFORCE-APP", appPolicy: enabledPolicy });
  await contentCraft.write(sessionA, { history: [{ role: "user", content: "one" }] });
  await aiForce.write(sessionA, { history: [{ role: "user", content: "two" }] });
  await contentCraft.reset(sessionA);
  assert.equal((await contentCraft.read(sessionA)).history.length, 0);
  assert.equal((await aiForce.read(sessionA)).history[0].content, "two");
});

test("invalid session IDs and unregistered apps fail closed", () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  assert.throws(() => store.read("../AIFORCE-APP"), /APP_MEMORY_INVALID_SESSION/);
  assert.throws(() => createAppMemoryStore({ kv, appId: "UNKNOWN-APP", appPolicy: enabledPolicy }), /APP_MEMORY_UNKNOWN_APP/);
});

test("history is bounded and accepts only user and assistant messages", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await store.write(sessionB, { history: [
    { role: "system", content: "drop" },
    ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }))
  ] });
  const result = await store.read(sessionB);
  assert.equal(result.history.length, 16);
  assert.equal(result.history[0].content, "4");
});
