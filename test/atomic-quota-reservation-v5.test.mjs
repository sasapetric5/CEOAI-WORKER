import test from "node:test";
import assert from "node:assert/strict";
import { reserveAtomicDailyQuota } from "../src/v5-modules/atomic-quota-reservation.mjs";

const response = (status, value) => ({ status, async json() { return value; } });

test("atomic reservation fails closed when coordinator is absent", async () => {
  assert.equal((await reserveAtomicDailyQuota(null, "gemini-1", 10)).reason, "atomic_quota_backend_unavailable");
});
test("atomic reservation fails closed when coordinator has no fetch method", async () => {
  assert.equal((await reserveAtomicDailyQuota({}, "gemini-1", 10)).allowed, false);
});
test("atomic reservation rejects invalid provider IDs", async () => {
  for (const id of ["", "../x", "bad id", "x".repeat(81), null]) {
    assert.equal((await reserveAtomicDailyQuota({ fetch() {} }, id, 10)).reason, "invalid_provider_id");
  }
});
test("atomic reservation rejects zero, negative, fractional and excessive limits", async () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, 1_000_001]) {
    assert.equal((await reserveAtomicDailyQuota({ fetch() {} }, "gemini-1", limit)).reason, "invalid_daily_limit");
  }
});
test("atomic reservation rejects invalid timestamps", async () => {
  assert.equal((await reserveAtomicDailyQuota({ fetch() {} }, "gemini-1", 10, -1)).reason, "invalid_timestamp");
  assert.equal((await reserveAtomicDailyQuota({ fetch() {} }, "gemini-1", 10, Infinity)).reason, "invalid_timestamp");
});
test("atomic reservation sends normalized provider, UTC day and limit", async () => {
  let request;
  const coordinator = { async fetch(url, init) { request = { url, init }; return response(200, { allowed: true, count: 1 }); } };
  const result = await reserveAtomicDailyQuota(coordinator, "gemini-1", 10, Date.UTC(2026, 9, 29, 23, 59));
  assert.deepEqual(result, { allowed: true, reason: "reserved", count: 1 });
  assert.equal(request.url, "https://ceoai.internal/reserve");
  assert.deepEqual(JSON.parse(request.init.body), { providerId: "gemini-1", day: "2026-10-29", limit: 10 });
});
test("atomic reservation reports a reached limit", async () => {
  const coordinator = { async fetch() { return response(200, { allowed: false, count: 10 }); } };
  assert.deepEqual(await reserveAtomicDailyQuota(coordinator, "gemini-1", 10), { allowed: false, reason: "daily_limit_reached", count: 10 });
});
test("atomic reservation fails closed on non-200 status", async () => {
  const coordinator = { async fetch() { return response(503, { allowed: true, count: 1 }); } };
  assert.equal((await reserveAtomicDailyQuota(coordinator, "gemini-1", 10)).reason, "atomic_quota_backend_invalid_response");
});
test("atomic reservation fails closed on malformed response data", async () => {
  for (const value of [null, {}, { allowed: "true", count: 1 }, { allowed: true, count: -1 }, { allowed: true, count: 1.5 }]) {
    const coordinator = { async fetch() { return response(200, value); } };
    assert.equal((await reserveAtomicDailyQuota(coordinator, "gemini-1", 10)).allowed, false);
  }
});
test("atomic reservation refuses backend counts above the configured cap", async () => {
  const coordinator = { async fetch() { return response(200, { allowed: true, count: 11 }); } };
  assert.equal((await reserveAtomicDailyQuota(coordinator, "gemini-1", 10)).reason, "atomic_quota_backend_limit_violation");
});
test("atomic reservation hides coordinator exception details", async () => {
  const coordinator = { async fetch() { throw new Error("secret internal URL"); } };
  const result = await reserveAtomicDailyQuota(coordinator, "gemini-1", 10);
  assert.deepEqual(result, { allowed: false, reason: "atomic_quota_backend_unavailable", count: null });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("atomic reservation rejects invalid JSON from coordinator", async () => {
  const coordinator = { async fetch() { return { status: 200, async json() { throw new Error("bad json"); } }; } };
  assert.equal((await reserveAtomicDailyQuota(coordinator, "gemini-1", 10)).reason, "atomic_quota_backend_unavailable");
});
test("atomic reservation never makes a provider call itself", async () => {
  let calls = 0;
  const coordinator = { async fetch() { calls++; return response(200, { allowed: true, count: 1 }); } };
  await reserveAtomicDailyQuota(coordinator, "gemini-1", 10);
  assert.equal(calls, 1);
});
test("atomic reservation treats an allowed count of zero as malformed", async () => {
  const coordinator = { async fetch() { return response(200, { allowed: true, count: 0 }); } };
  const result = await reserveAtomicDailyQuota(coordinator, "gemini-1", 10);
  assert.deepEqual(result, { allowed: false, reason: "atomic_quota_backend_invalid_result", count: null });
});
