import test from "node:test";
import assert from "node:assert/strict";
import { handleMemoryReset, readSessionId, withSessionLock } from "../src/v5-modules/session.mjs";

const SID = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";
const ORIGIN = "https://ceoai.dev";
function setup() {
  const data = new Map([[ `session:${SID}`, "1" ], [ `memory:${SID}`, JSON.stringify({ messages: [{ role: "user", content: "private" }] }) ]]);
  const kv = { async get(k) { return data.has(k) ? data.get(k) : null; }, async put(k,v) { data.set(k,v); }, async delete(k) { data.delete(k); }, data };
  return { kv, env: { KV_MEMORY: kv, ALLOWED_ORIGINS: ORIGIN } };
}
const request = headers => new Request("https://ceoai.dev/api/reset", { method: "POST", headers });
test("reset requires allowlisted origin and a valid session cookie", async () => {
  const { kv, env } = setup();
  assert.equal((await handleMemoryReset(request({ Origin: "https://evil.example", Cookie: `ceoai_session=${SID}` }), env)).status, 403);
  assert.equal((await handleMemoryReset(request({ Origin: ORIGIN, Cookie: "ceoai_session=bad" }), env)).status, 401);
  assert.equal(readSessionId(request({ Cookie: `ceoai_session=${SID}` })), SID);
  const res = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(res.status, 200);
  assert.equal(kv.data.has(`memory:${SID}`), false);
  assert.equal(kv.data.get(`session:${SID}`), "1");
});
test("session lock rejects overlapping work and releases after completion", async () => {
  const { kv } = setup();
  let release;
  const pending = withSessionLock(kv, SID, () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(await withSessionLock(kv, SID, async () => "second"), { busy: true });
  release("first");
  assert.deepEqual(await pending, { busy: false, value: "first" });
  assert.deepEqual(await withSessionLock(kv, SID, async () => "again"), { busy: false, value: "again" });
});

test("session lock releases after callback throws", async () => {
  const { kv } = setup();
  await assert.rejects(
    withSessionLock(kv, SID, async () => { throw new Error("callback failed"); }),
    /callback failed/
  );
  assert.equal(kv.data.has(`lock:${SID}`), false);
  assert.deepEqual(await withSessionLock(kv, SID, async () => "recovered"), { busy: false, value: "recovered" });
});

test("session lock fails closed when KV read fails", async () => {
  const { kv } = setup();
  kv.get = async () => { throw new Error("KV unavailable"); };
  await assert.rejects(withSessionLock(kv, SID, async () => "must not run"), /KV unavailable/);
});

test("session lock fails closed when KV write fails", async () => {
  const { kv } = setup();
  kv.put = async () => { throw new Error("KV write failed"); };
  let called = false;
  await assert.rejects(withSessionLock(kv, SID, async () => { called = true; }), /KV write failed/);
  assert.equal(called, false, "protected callback must not run without an acquired lock");
});

test("memory reset returns unavailable when session lookup fails", async () => {
  const { kv, env } = setup();
  kv.get = async () => { throw new Error("KV read failed"); };
  const response = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
});

test("memory reset reports delete failure without claiming success", async () => {
  const { kv, env } = setup();
  kv.delete = async () => { throw new Error("KV delete failed"); };
  const response = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
  assert.equal(kv.data.has(`memory:${SID}`), true);
});

// Batch session reset regressions: method, missing session, and missing KV operations.
test("memory reset rejects non-POST methods without changing memory", async () => {
  const { kv, env } = setup();
  const res = await handleMemoryReset(new Request("https://ceoai.dev/api/reset", {
    method: "GET", headers: { Origin: ORIGIN, Cookie: `ceoai_session=${SID}` },
  }), env);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
  assert.equal(kv.data.has(`memory:${SID}`), true);
});

test("memory reset rejects a valid-looking cookie for an unknown session", async () => {
  const { kv, env } = setup();
  const unknown = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const res = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${unknown}` }), env);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).success, false);
  assert.equal(kv.data.has(`memory:${SID}`), true);
});

test("memory reset fails safely when KV delete is unavailable", async () => {
  const { env } = setup();
  env.KV_MEMORY.delete = undefined;
  const res = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).success, false);
});

test("session cookie parser rejects malformed and duplicate-lookalike values", () => {
  assert.equal(readSessionId(request({ Cookie: "ceoai_session=not-a-uuid" })), null);
  assert.equal(readSessionId(request({ Cookie: "other=value; ceoai_session=bad" })), null);
});

