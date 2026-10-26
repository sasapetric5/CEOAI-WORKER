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

// Batch lock and reset edge cases: callback result, lock cleanup, and missing session storage.
test("session lock returns the callback result without leaking internal lock metadata", async () => {
  const { kv } = setup();
  const result = await withSessionLock(kv, SID, async () => ({ answer: 42 }));
  assert.deepEqual(result, { busy: false, value: { answer: 42 } });
  assert.equal(kv.data.has(`lock:${SID}`), false);
});

test("session lock releases after callback rejects with a non-Error value", async () => {
  const { kv } = setup();
  await assert.rejects(withSessionLock(kv, SID, async () => { throw "rejected"; }), e => e === "rejected");
  assert.equal(kv.data.has(`lock:${SID}`), false);
});

test("memory reset rejects when KV session lookup returns missing", async () => {
  const { kv, env } = setup();
  kv.data.delete(`session:${SID}`);
  const response = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(response.status, 401);
  assert.equal(kv.data.has(`memory:${SID}`), true);
});

test("memory reset rejects when KV binding is missing", async () => {
  const { env } = setup();
  env.KV_MEMORY = undefined;
  const response = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).success, false);
});

// Batch isolation and malformed-cookie regressions.
test("different session IDs use independent lock keys", async () => {
  const { kv } = setup();
  const other = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  let releaseFirst;
  const first = withSessionLock(kv, SID, () => new Promise(resolve => { releaseFirst = resolve; }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = await withSessionLock(kv, other, async () => "other-session");
  assert.deepEqual(second, { busy: false, value: "other-session" });
  assert.deepEqual(await withSessionLock(kv, SID, async () => "must-not-run"), { busy: true });
  releaseFirst("first-session");
  assert.deepEqual(await first, { busy: false, value: "first-session" });
});

test("session lock remains usable when cleanup KV read fails", async () => {
  const { kv } = setup();
  let reads = 0;
  const originalGet = kv.get.bind(kv);
  kv.get = async key => {
    reads++;
    if (key.startsWith("lock:") && reads >= 3) throw new Error("cleanup read failed");
    return originalGet(key);
  };
  const result = await withSessionLock(kv, SID, async () => "completed");
  assert.deepEqual(result, { busy: false, value: "completed" });
  assert.equal(kv.data.has(`lock:${SID}`), true, "failed cleanup leaves the expiring lock rather than failing completed work");
});

test("duplicate session cookies with an invalid first value are rejected", () => {
  const req = request({ Cookie: `ceoai_session=bad; ceoai_session=${SID}` });
  assert.equal(readSessionId(req), null);
});

test("memory reset rejects an origin that differs by trailing slash", async () => {
  const { kv, env } = setup();
  const response = await handleMemoryReset(request({ Origin: `${ORIGIN}/`, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(response.status, 403);
  assert.equal(kv.data.has(`memory:${SID}`), true);
});

// Batch 3: session isolation, reset authorization, and rate-limit edge cases.
test("session reset rejects missing Origin even with a valid cookie", async () => {
  const { kv, env } = setup();
  const res = await handleMemoryReset(request({ Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(res.status, 403);
  assert.equal(kv.data.has(`memory:${SID}`), true);
});

test("session reset rejects a malformed Origin without touching memory", async () => {
  const { kv, env } = setup();
  const res = await handleMemoryReset(request({ Origin: "null", Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(res.status, 403);
  assert.equal(kv.data.has(`memory:${SID}`), true);
});

test("allowlisted origins are trimmed and split by commas", async () => {
  const { kv, env } = setup();
  env.ALLOWED_ORIGINS = " https://other.example , https://ceoai.dev ";
  const res = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(res.status, 200);
  assert.equal(kv.data.has(`memory:${SID}`), false);
});

test("reset does not delete the session registration record", async () => {
  const { kv, env } = setup();
  const res = await handleMemoryReset(request({ Origin: ORIGIN, Cookie: `ceoai_session=${SID}` }), env);
  assert.equal(res.status, 200);
  assert.equal(kv.data.has(`session:${SID}`), true);
  assert.equal(kv.data.has(`memory:${SID}`), false);
});

test("session lock does not run callback if token verification loses a race", async () => {
  const { kv } = setup();
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options) => {
    if (key === `lock:${SID}`) return originalPut(key, "another-owner-token", options);
    return originalPut(key, value, options);
  };
  let called = false;
  const result = await withSessionLock(kv, SID, async () => { called = true; });
  assert.deepEqual(result, { busy: true });
  assert.equal(called, false);
});

test("session lock reports busy when another lock value already exists", async () => {
  const { kv } = setup();
  kv.data.set(`lock:${SID}`, "existing-owner");
  let called = false;
  const result = await withSessionLock(kv, SID, async () => { called = true; });
  assert.deepEqual(result, { busy: true });
  assert.equal(called, false);
});

test("session lock deletes only its own token and preserves replacement lock", async () => {
  const { kv } = setup();
  const originalGet = kv.get.bind(kv);
  let lockReads = 0;
  kv.get = async key => {
    if (key === `lock:${SID}`) {
      lockReads++;
      if (lockReads >= 3) { kv.data.set(`lock:${SID}`, "replacement-owner"); return "replacement-owner"; }
    }
    return originalGet(key);
  };
  const result = await withSessionLock(kv, SID, async () => "done");
  assert.deepEqual(result, { busy: false, value: "done" });
  assert.equal(kv.data.get(`lock:${SID}`), "replacement-owner");
});

test("session lock handles callback returning undefined and still cleans up", async () => {
  const { kv } = setup();
  const result = await withSessionLock(kv, SID, async () => undefined);
  assert.deepEqual(result, { busy: false, value: undefined });
  assert.equal(kv.data.has(`lock:${SID}`), false);
});

test("rate limiter allows session creation when binding is not configured", async () => {
  const { limitSessionCreation } = await import("../src/v5-modules/session.mjs");
  const result = await limitSessionCreation(new Request("https://ceoai.dev/"), {});
  assert.deepEqual(result, { ok: true, retryAfter: 0 });
});

test("rate limiter rejects when provider explicitly reports limit exceeded", async () => {
  const { limitSessionCreation } = await import("../src/v5-modules/session.mjs");
  let keySeen;
  const result = await limitSessionCreation(new Request("https://ceoai.dev/", {
    headers: { "CF-Connecting-IP": "203.0.113.7" },
  }), { RATE_LIMITER: { async limit(input) { keySeen = input.key; return { success: false }; } } });
  assert.deepEqual(result, { ok: false, retryAfter: 60 });
  assert.equal(keySeen, "page:203.0.113.7");
});

test("rate limiter failure is handled without exposing exception details", async () => {
  const { limitSessionCreation } = await import("../src/v5-modules/session.mjs");
  const result = await limitSessionCreation(new Request("https://ceoai.dev/"), {
    RATE_LIMITER: { async limit() { throw new Error("private limiter detail"); } },
  });
  assert.deepEqual(result, { ok: true, retryAfter: 0 });
});

