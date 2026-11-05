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


// Consolidated edge-case batch: storage corruption, input validation and bounded values.
test("corrupt stored history fails closed without exposing raw storage content", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  const historyKey = "app-memory:v1:CONTENTCRAFT-APP:" + sessionA + ":history";
  const summaryKey = "app-memory:v1:CONTENTCRAFT-APP:" + sessionA + ":summary";
  await kv.put(historyKey, "{not-json", { expirationTtl: 60 });
  await kv.put(summaryKey, "safe-summary", { expirationTtl: 60 });
  assert.deepEqual(await store.read(sessionA), { history: [], summary: "safe-summary" });
});

test("non-array stored history is ignored", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await kv.put("app-memory:v1:CONTENTCRAFT-APP:" + sessionA + ":history", JSON.stringify({ role: "user", content: "not-an-array" }), { expirationTtl: 60 });
  assert.deepEqual((await store.read(sessionA)).history, []);
});

test("stored history filters malformed records and unsupported roles", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  const key = "app-memory:v1:CONTENTCRAFT-APP:" + sessionA + ":history";
  await kv.put(key, JSON.stringify([
    null,
    { role: "system", content: "must-not-load" },
    { role: "user", content: 42 },
    { role: "assistant", content: "valid-answer" }
  ]), { expirationTtl: 60 });
  assert.deepEqual((await store.read(sessionA)).history, [{ role: "assistant", content: "valid-answer" }]);
});

test("write truncates individual message content to the documented read bound", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await store.write(sessionA, { history: [{ role: "user", content: "x".repeat(9000) }] });
  assert.equal((await store.read(sessionA)).history[0].content.length, 8000);
});

test("write truncates summary to the documented read bound", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await store.write(sessionA, { summary: "s".repeat(5000) });
  assert.equal((await store.read(sessionA)).summary.length, 4000);
});

test("write rejects non-array history before touching storage", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await assert.rejects(store.write(sessionA, { history: "not-an-array" }), /APP_MEMORY_INVALID_VALUE/);
  assert.equal(kv.data.size, 0);
});

test("write rejects non-string summaries before touching storage", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await assert.rejects(store.write(sessionA, { summary: { private: true } }), /APP_MEMORY_INVALID_VALUE/);
  assert.equal(kv.data.size, 0);
});

test("oversized summary is rejected atomically without writing history or summary", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await assert.rejects(
    store.write(sessionA, { history: [{ role: "user", content: "valid" }], summary: "s".repeat(25000) }),
    /APP_MEMORY_VALUE_TOO_LARGE/
  );
  assert.equal(kv.data.size, 0);
});

test("invalid history records are discarded before the accepted payload is measured", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await store.write(sessionA, { history: [
    { role: "system", content: "x".repeat(30000) },
    { role: "user", content: "accepted" }
  ] });
  assert.deepEqual((await store.read(sessionA)).history, [{ role: "user", content: "accepted" }]);
});

test("the maximum supported thirty-day TTL is accepted and applied to both records", async () => {
  const ttls = [];
  const kv = {
    async get() { return null; },
    async put(_key, _value, options) { ttls.push(options.expirationTtl); },
    async delete() {}
  };
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy, ttlSeconds: 60 * 60 * 24 * 30 });
  await store.write(sessionA, { history: [{ role: "user", content: "ttl-boundary" }] });
  assert.deepEqual(ttls, [60 * 60 * 24 * 30, 60 * 60 * 24 * 30]);
});

test("TTL above the thirty-day ceiling is rejected", async () => {
  const kv = memoryKV();
  assert.throws(
    () => createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy, ttlSeconds: 60 * 60 * 24 * 30 + 1 }),
    /APP_MEMORY_INVALID_TTL/
  );
  assert.equal(kv.data.size, 0);
});

test("app memory store is immutable and remains bound to its authenticated app", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "AIFORCE-APP", appPolicy: enabledPolicy });
  assert.equal(Object.isFrozen(store), true);
  assert.equal(Reflect.set(store, "appId", "CONTENTCRAFT-APP"), false);
  await store.write(sessionA, { history: [{ role: "user", content: "bound-to-aiforce" }] });
  assert.equal([...kv.data.keys()].every(key => key.startsWith("app-memory:v1:AIFORCE-APP:")), true);
});

test("reset is idempotent for an already empty app session", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "RANKGEO-APP", appPolicy: enabledPolicy });
  assert.deepEqual(await store.reset(sessionA), { success: true });
  assert.deepEqual(await store.reset(sessionA), { success: true });
  assert.deepEqual(await store.read(sessionA), { history: [], summary: "" });
  assert.equal(kv.data.size, 0);
});


// Second consolidated batch: constructor guards, UTF-8 accounting and storage boundaries.
test("store creation rejects a missing KV binding", () => {
  assert.throws(
    () => createAppMemoryStore({ appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy }),
    /APP_MEMORY_STORAGE_UNAVAILABLE/
  );
});

test("store creation rejects KV bindings missing required methods", () => {
  assert.throws(
    () => createAppMemoryStore({ kv: { get: async () => null, put: async () => {} }, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy }),
    /APP_MEMORY_STORAGE_UNAVAILABLE/
  );
});

test("store creation rejects a missing app policy", () => {
  assert.throws(
    () => createAppMemoryStore({ kv: memoryKV(), appId: "CONTENTCRAFT-APP" }),
    /APP_MEMORY_NOT_CONFIGURED/
  );
});

test("store creation rejects disabled app policy even when memory is enabled", () => {
  assert.throws(
    () => createAppMemoryStore({ kv: memoryKV(), appId: "CONTENTCRAFT-APP", appPolicy: { enabled: false, memory: true } }),
    /APP_DISABLED/
  );
});

test("store creation rejects fractional TTL values", () => {
  assert.throws(
    () => createAppMemoryStore({ kv: memoryKV(), appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy, ttlSeconds: 60.5 }),
    /APP_MEMORY_INVALID_TTL/
  );
});

test("store creation accepts the minimum supported sixty-second TTL", async () => {
  const ttls = [];
  const kv = { async get() { return null; }, async put(_key, _value, options) { ttls.push(options.expirationTtl); }, async delete() {} };
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy, ttlSeconds: 60 });
  await store.write(sessionA, { summary: "minimum-ttl" });
  assert.deepEqual(ttls, [60, 60]);
});

test("UTF-8 byte accounting rejects oversized multibyte text", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await assert.rejects(
    store.write(sessionA, { summary: "😀".repeat(7000) }),
    /APP_MEMORY_VALUE_TOO_LARGE/
  );
  assert.equal(kv.data.size, 0);
});

test("write of an empty conversation persists a valid empty state", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  assert.deepEqual(await store.write(sessionA), { success: true });
  assert.deepEqual(await store.read(sessionA), { history: [], summary: "" });
  assert.equal(kv.data.size, 2);
});

test("read bounds externally stored history to the newest sixteen entries", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  const key = "app-memory:v1:CONTENTCRAFT-APP:" + sessionA + ":history";
  await kv.put(key, JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ role: "user", content: String(i) }))), { expirationTtl: 60 });
  const result = await store.read(sessionA);
  assert.equal(result.history.length, 16);
  assert.equal(result.history[0].content, "9");
  assert.equal(result.history.at(-1).content, "24");
});

test("read truncates externally stored message content to eight thousand characters", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  const key = "app-memory:v1:CONTENTCRAFT-APP:" + sessionA + ":history";
  await kv.put(key, JSON.stringify([{ role: "assistant", content: "z".repeat(9000) }]), { expirationTtl: 60 });
  assert.equal((await store.read(sessionA)).history[0].content.length, 8000);
});

test("read truncates externally stored summary to four thousand characters", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "CONTENTCRAFT-APP", appPolicy: enabledPolicy });
  await kv.put("app-memory:v1:CONTENTCRAFT-APP:" + sessionA + ":summary", "m".repeat(5000), { expirationTtl: 60 });
  assert.equal((await store.read(sessionA)).summary.length, 4000);
});

test("summary and history use distinct keys within the same app session", async () => {
  const kv = memoryKV();
  const store = createAppMemoryStore({ kv, appId: "RANKGEO-APP", appPolicy: enabledPolicy });
  await store.write(sessionA, { history: [{ role: "user", content: "history-marker" }], summary: "summary-marker" });
  const keys = [...kv.data.keys()];
  assert.equal(keys.length, 2);
  assert.ok(keys.some(key => key.endsWith(":history")));
  assert.ok(keys.some(key => key.endsWith(":summary")));
  const result = await store.read(sessionA);
  assert.equal(result.history[0].content, "history-marker");
  assert.equal(result.summary, "summary-marker");
});
