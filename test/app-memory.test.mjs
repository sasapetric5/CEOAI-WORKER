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

test("RankGeo receives an enabled but isolated memory namespace", async () => {
  const kv = memoryKV();
  const rankGeo = createAppMemoryStore({
    kv,
    appId: "RANKGEO-APP",
    appPolicy: { enabled: true, memory: true }
  });
  await rankGeo.write(sessionA, { history: [{ role: "user", content: "rankgeo-only" }] });
  assert.match(rankGeo.namespacePrefix, /RANKGEO-APP/);
  assert.equal((await rankGeo.read(sessionA)).history[0].content, "rankgeo-only");
  assert.equal([...kv.data.keys()].every(key => key.startsWith("app-memory:v1:RANKGEO-APP:")), true);
});

test("all three applications remain isolated when they reuse the same conversation UUID", async () => {
  const kv = memoryKV();
  const appIds = ["CONTENTCRAFT-APP", "AIFORCE-APP", "RANKGEO-APP"];
  const stores = appIds.map(appId => createAppMemoryStore({ kv, appId, appPolicy: enabledPolicy }));
  for (let i = 0; i < stores.length; i++) {
    await stores[i].write(sessionA, { history: [{ role: "user", content: appIds[i] + "-private" }] });
  }
  for (let i = 0; i < stores.length; i++) {
    const own = await stores[i].read(sessionA);
    assert.equal(own.history[0].content, appIds[i] + "-private");
    for (let j = 0; j < stores.length; j++) {
      if (j !== i) assert.notEqual(own.history[0].content, appIds[j] + "-private");
    }
  }
  assert.equal([...kv.data.keys()].length, 6);
  assert.equal([...kv.data.keys()].every(key => appIds.some(appId => key.startsWith("app-memory:v1:" + appId + ":"))), true);
});

test("reset only deletes the bound app and session namespace", async () => {
  const kv = memoryKV();
  const contentCraft = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  const aiForce = createAppMemoryStore({ kv, appId: "AIFORCE-APP", appPolicy: enabledPolicy });
  await contentCraft.write(sessionA, { history: [{ role: "user", content: "one" }] });
  await contentCraft.write(sessionB, { history: [{ role: "user", content: "same app, other session" }] });
  await aiForce.write(sessionA, { history: [{ role: "user", content: "two" }] });
  await contentCraft.reset(sessionA);
  assert.equal((await contentCraft.read(sessionA)).history.length, 0);
  assert.equal((await contentCraft.read(sessionB)).history[0].content, "same app, other session");
  assert.equal((await aiForce.read(sessionA)).history[0].content, "two");
});

test("invalid session IDs and unregistered apps fail closed", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await assert.rejects(store.read("../AIFORCE-APP"), /APP_MEMORY_INVALID_SESSION/);
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


test("app memory refuses policies that do not explicitly enable memory", async () => {
  const kv = memoryKV();
  assert.throws(
    () => createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: { enabled: true, memory: false } }),
    /APP_MEMORY_NOT_CONFIGURED/
  );
  assert.throws(
    () => createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: { enabled: true } }),
    /APP_MEMORY_NOT_CONFIGURED/
  );
  assert.equal(kv.data.size, 0);
});

test("app memory enforces TTL and serialized byte limits", async () => {
  const kv = memoryKV();
  assert.throws(
    () => createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy, ttlSeconds: 30 }),
    /APP_MEMORY_INVALID_TTL/
  );
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await assert.rejects(
    store.write(sessionA, { history: [{ role: "user", content: "x".repeat(25000) }] }),
    /APP_MEMORY_VALUE_TOO_LARGE/
  );
  assert.equal(kv.data.size, 0);
});


test("reset is bound to one application and cannot delete another application's session", async () => {
  const kv = memoryKV();
  const contentCraft = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  const aiForce = createAppMemoryStore({ kv, appId: "AIFORCE-APP", appPolicy: enabledPolicy });
  const rankGeo = createAppMemoryStore({ kv, appId: "RANKGEO-APP", appPolicy: enabledPolicy });
  for (const [store, marker] of [[contentCraft, "cc"], [aiForce, "af"], [rankGeo, "rg"]]) {
    await store.write(sessionA, { history: [{ role: "user", content: marker + "-private" }] });
  }
  await contentCraft.reset(sessionA);
  assert.equal((await contentCraft.read(sessionA)).history.length, 0);
  assert.equal((await aiForce.read(sessionA)).history[0].content, "af-private");
  assert.equal((await rankGeo.read(sessionA)).history[0].content, "rg-private");
  await assert.rejects(contentCraft.reset("AIFORCE-APP"), /APP_MEMORY_INVALID_SESSION/);
  assert.equal((await aiForce.read(sessionA)).history[0].content, "af-private");
});

test("application memory expires according to its configured KV TTL", async () => {
  let now = 1_000_000;
  const data = new Map();
  const kv = {
    async get(key) {
      const item = data.get(key);
      if (!item) return null;
      if (item.expiresAt <= now) { data.delete(key); return null; }
      return item.value;
    },
    async put(key, value, options) {
      assert.equal(options.expirationTtl, 60);
      data.set(key, { value, expiresAt: now + options.expirationTtl * 1000 });
    },
    async delete(key) { data.delete(key); },
  };
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy, ttlSeconds: 60 });
  await store.write(sessionA, { history: [{ role: "user", content: "expires-soon" }] });
  assert.equal((await store.read(sessionA)).history[0].content, "expires-soon");
  now += 60_001;
  assert.deepEqual(await store.read(sessionA), { history: [], summary: "" });
});
