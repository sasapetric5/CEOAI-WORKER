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
