import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFreeQuotaEligibility, dailyProviderCallLimit, dailyProviderUsageKey,
  reserveProviderCall, estimateTokenCount, dailyTokenEstimateKey, recordProviderTokenEstimate,
} from "../src/v5-modules/provider-cost-guard.mjs";
import {
  createRequestDeadline, remainingRequestBudget, adaptiveProviderTimeout, canStartProviderAttempt,
  DEFAULT_REQUEST_BUDGET_MS, MIN_ATTEMPT_BUDGET_MS, MAX_PROVIDER_TIMEOUT_MS,
} from "../src/v5-modules/adaptive-timeout.mjs";
import {
  normalizeLatencyMs, nextLatencyEwma, providerLatencyRoutingAdjustment,
} from "../src/v5-modules/provider-latency.mjs";
import { providerHealthRoutingAdjustment, providerRecoveryAction } from "../src/v5-modules/provider-recovery.mjs";

class MemoryKV {
  constructor() { this.data = new Map(); this.fail = false; }
  async get(key, type) {
    if (this.fail) throw new Error("test store failure");
    const v = this.data.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key, value) {
    if (this.fail) throw new Error("test store failure");
    this.data.set(key, String(value));
  }
}

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const quotaEnv = { CEOAI_FREE_DAILY_CALL_LIMIT: "2" };

test("daily call limit defaults to unlimited only when explicitly unset", () => {
  assert.equal(dailyProviderCallLimit({}), 0);
});
test("daily call limit accepts zero as a hard stop", () => {
  assert.equal(dailyProviderCallLimit({ CEOAI_FREE_DAILY_CALL_LIMIT: "0" }), 0);
});
test("invalid daily call limit fails closed", () => {
  for (const value of ["-1", "1.5", "NaN", "1e3", "10000000", "oops"]) {
    assert.equal(dailyProviderCallLimit({ CEOAI_FREE_DAILY_CALL_LIMIT: value }), -1);
  }
});
test("provider-specific daily cap overrides the global cap", () => {
  assert.equal(dailyProviderCallLimit({
    CEOAI_FREE_DAILY_CALL_LIMIT: "10", CEOAI_FREE_DAILY_CALL_LIMIT_OPENROUTER_1: "3",
  }, "openrouter-1"), 3);
});
test("invalid provider-specific cap fails closed instead of falling back", () => {
  assert.equal(dailyProviderCallLimit({
    CEOAI_FREE_DAILY_CALL_LIMIT: "10", CEOAI_FREE_DAILY_CALL_LIMIT_OPENROUTER_1: "bad",
  }, "openrouter-1"), -1);
});
test("usage keys are stable for the same UTC day", () => {
  assert.equal(dailyProviderUsageKey("openrouter-1", NOW), "free-usage:v1:2026-10-29:openrouter-1");
});
test("usage keys change at UTC midnight", () => {
  assert.notEqual(dailyProviderUsageKey("openrouter-1", NOW), dailyProviderUsageKey("openrouter-1", NOW + 12 * 3600_000));
});
test("usage key rejects malformed provider IDs", () => {
  for (const id of ["", "../openrouter", "bad id", "a".repeat(81), null]) {
    assert.equal(dailyProviderUsageKey(id, NOW), null);
  }
});
test("usage key rejects negative or non-finite timestamps", () => {
  assert.equal(dailyProviderUsageKey("openrouter-1", -1), null);
  assert.equal(dailyProviderUsageKey("openrouter-1", Infinity), null);
});
test("quota reservation increments an allowed call", async () => {
  const kv = new MemoryKV();
  assert.deepEqual(await reserveProviderCall(kv, "openrouter-1", quotaEnv, NOW), {
    allowed: true, reason: "reserved", count: 1,
  });
});
test("quota reservation blocks after the configured cap", async () => {
  const kv = new MemoryKV();
  await reserveProviderCall(kv, "openrouter-1", quotaEnv, NOW);
  await reserveProviderCall(kv, "openrouter-1", quotaEnv, NOW);
  assert.deepEqual(await reserveProviderCall(kv, "openrouter-1", quotaEnv, NOW), {
    allowed: false, reason: "daily_limit_reached", count: 2,
  });
});
test("quota reservation fails closed when storage is unavailable", async () => {
  const kv = new MemoryKV(); kv.fail = true;
  const result = await reserveProviderCall(kv, "openrouter-1", quotaEnv, NOW);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "usage_store_unavailable");
});
test("quota reservation rejects corrupted usage state", async () => {
  const kv = new MemoryKV();
  kv.data.set(dailyProviderUsageKey("openrouter-1", NOW), "not-a-number");
  const result = await reserveProviderCall(kv, "openrouter-1", quotaEnv, NOW);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "usage_state_invalid");
});
test("quota reservation rejects missing KV methods", async () => {
  assert.equal((await reserveProviderCall({}, "openrouter-1", quotaEnv, NOW)).allowed, false);
});
test("free quota eligibility rejects unknown provider", () => {
  assert.deepEqual(checkFreeQuotaEligibility({ provider: "mystery", model: "x", key: "k" }, {}), {
    allowed: false, reason: "provider_not_allowlisted",
  });
});
test("free quota eligibility requires explicit free confirmation", () => {
  assert.equal(checkFreeQuotaEligibility({
    provider: "openrouter", model: "openai/gpt-oss-20b:free", key: "test-key",
  }, {}).reason, "free_tier_not_confirmed");
});
test("token estimate is zero for empty input", () => {
  assert.equal(estimateTokenCount(""), 0);
});
test("token estimate rounds upward for short input", () => {
  assert.equal(estimateTokenCount("12345"), 2);
});
test("token estimate is bounded for extremely long input", () => {
  assert.equal(estimateTokenCount("x".repeat(50_000_000)), 10_000_000);
});
test("token estimate key shares validated provider and UTC date rules", () => {
  assert.equal(dailyTokenEstimateKey("openrouter-1", NOW), "free-token-estimate:v1:2026-10-29:openrouter-1");
  assert.equal(dailyTokenEstimateKey("../x", NOW), null);
});
test("token estimates record bounded diagnostic totals", async () => {
  const kv = new MemoryKV();
  const result = await recordProviderTokenEstimate(kv, "openrouter-1", "a".repeat(8), "b".repeat(12), NOW);
  assert.equal(result.recorded, true);
  assert.equal(result.estimatedInputTokens, 2);
  assert.equal(result.estimatedOutputTokens, 3);
  assert.equal(result.estimatedTotalTokens, 5);
  assert.equal(result.samples, 1);
});
test("token estimate store failure is reported without throwing", async () => {
  const kv = new MemoryKV(); kv.fail = true;
  assert.deepEqual(await recordProviderTokenEstimate(kv, "openrouter-1", "in", "out", NOW), {
    recorded: false, reason: "usage_store_unavailable",
  });
});
test("request deadline rejects a budget larger than the hard maximum", () => {
  assert.equal(createRequestDeadline(NOW, DEFAULT_REQUEST_BUDGET_MS + 1), null);
});
test("request deadline rejects non-finite time inputs", () => {
  assert.equal(createRequestDeadline(Infinity, 5000), null);
  assert.equal(createRequestDeadline(NOW, NaN), null);
});
test("remaining request budget never goes negative", () => {
  assert.equal(remainingRequestBudget(NOW, NOW + 50), 0);
});
test("remaining request budget floors fractional milliseconds", () => {
  assert.equal(remainingRequestBudget(NOW + 20.9, NOW), 20);
});
test("provider timeout is zero below the minimum attempt budget", () => {
  assert.equal(adaptiveProviderTimeout(MIN_ATTEMPT_BUDGET_MS - 1), 0);
});
test("provider timeout never exceeds the configured maximum", () => {
  assert.equal(adaptiveProviderTimeout(100_000, 120_000), MAX_PROVIDER_TIMEOUT_MS);
});
test("provider attempt gate rejects NaN and Infinity", () => {
  assert.equal(canStartProviderAttempt(NaN), false);
  assert.equal(canStartProviderAttempt(Infinity), false);
});
test("latency normalization rejects zero and out-of-range samples", () => {
  assert.equal(normalizeLatencyMs(0), null);
  assert.equal(normalizeLatencyMs(120_001), null);
});
test("latency normalization rounds valid samples", () => {
  assert.equal(normalizeLatencyMs(12.7), 13);
});
test("EWMA starts from the first valid sample", () => {
  assert.equal(nextLatencyEwma(null, 1000), 1000);
});
test("EWMA ignores invalid samples and preserves valid history", () => {
  assert.equal(nextLatencyEwma(1000, -1), 1000);
});
test("EWMA rejects invalid alpha and uses safe default", () => {
  assert.equal(nextLatencyEwma(1000, 2000, 0), 1300);
});
test("stale provider latency does not affect routing", () => {
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 1000, updatedAt: NOW - 3_600_001 }, NOW), 0);
});
test("future provider latency timestamp does not affect routing", () => {
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 1000, updatedAt: NOW + 1 }, NOW), 0);
});
test("healthy provider gets bounded latency preference", () => {
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 1000, updatedAt: NOW }, NOW), 0.25);
});
test("slow provider receives bounded latency penalty", () => {
  assert.equal(providerLatencyRoutingAdjustment({ latencyEwmaMs: 15000, updatedAt: NOW }, NOW), -0.25);
});
test("stale health does not change provider routing", () => {
  assert.equal(providerHealthRoutingAdjustment({ status: "healthy", consecutiveFailures: 0, updatedAt: NOW - 3_600_001 }, NOW), 0);
});
test("future health timestamp does not change provider routing", () => {
  assert.equal(providerHealthRoutingAdjustment({ status: "healthy", consecutiveFailures: 0, updatedAt: NOW + 1 }, NOW), 0);
});
test("healthy recent provider gets a small health preference", () => {
  assert.equal(providerHealthRoutingAdjustment({ status: "healthy", consecutiveFailures: 0, updatedAt: NOW }, NOW), 0.2);
});
test("unavailable provider gets bounded health penalty", () => {
  assert.ok(Math.abs(providerHealthRoutingAdjustment({ status: "unavailable", consecutiveFailures: 99, updatedAt: NOW }, NOW) - (-0.3)) < 1e-9);
});
test("recovery action is normal when health is stale", () => {
  assert.equal(providerRecoveryAction({ status: "unavailable", updatedAt: NOW - 3_600_001 }, NOW), "normal");
});
test("recovery action recommends probe after cooldown for rate-limited provider", () => {
  assert.equal(providerRecoveryAction({ status: "rate_limited", updatedAt: NOW }, NOW), "probe_after_cooldown");
});
test("recovery action reports healthy provider as recovered", () => {
  assert.equal(providerRecoveryAction({ status: "healthy", consecutiveFailures: 0, updatedAt: NOW }, NOW), "recovered");
});
