import test from "node:test";
import assert from "node:assert/strict";
import {
  isFreeModelAllowed, checkFreeQuotaEligibility, dailyProviderCallLimit,
  dailyProviderUsageKey, reserveProviderCall, estimateTokenCount, dailyTokenEstimateKey, recordProviderTokenEstimate,
} from "../src/v5-modules/provider-cost-guard.mjs";

class MemoryKV {
  constructor() { this.data = new Map(); }
  async get(k) { return this.data.has(k) ? this.data.get(k) : null; }
  async put(k, v) { this.data.set(k, String(v)); }
}

test("free model allowlist rejects paid or unknown model identifiers", () => {
  assert.equal(isFreeModelAllowed("openrouter", "meta-llama/llama-3-8b-instruct:free"), true);
  assert.equal(isFreeModelAllowed("openrouter", "openai/gpt-4o"), false);
  assert.equal(isFreeModelAllowed("mistral", "open-mistral-nemo"), true);
  assert.equal(isFreeModelAllowed("mistral", "mistral-large-latest"), false);
  assert.equal(isFreeModelAllowed("unknown-provider", "model"), false);
});

test("provider call is denied by default unless provider, model, key and free-tier flag are valid", () => {
  const candidate = { provider: "gemini", model: "gemini-1.5-flash", key: "test-key" };
  assert.equal(checkFreeQuotaEligibility(candidate, {}).allowed, false);
  assert.equal(checkFreeQuotaEligibility(candidate, { GEMINI_FREE_CONFIRMED: "true" }).allowed, true);
  assert.equal(checkFreeQuotaEligibility({ ...candidate, model: "gpt-4o" }, { GEMINI_FREE_CONFIRMED: "true" }).reason, "model_not_allowlisted");
  assert.equal(checkFreeQuotaEligibility({ ...candidate, key: "" }, { GEMINI_FREE_CONFIRMED: "true" }).reason, "provider_key_missing");
  assert.equal(checkFreeQuotaEligibility({ provider: "rogue", model: "x", key: "k" }, {}).reason, "provider_not_allowlisted");
});

test("Workers AI requires both explicit enablement and a binding", () => {
  const candidate = { provider: "workers-ai", model: "@cf/meta/llama-3-8b-instruct", key: "" };
  assert.equal(checkFreeQuotaEligibility(candidate, { WORKERS_AI_FREE_CONFIRMED: "true", WORKERS_AI_ENABLED: "true", AI: {} }).allowed, true);
  assert.equal(checkFreeQuotaEligibility(candidate, { WORKERS_AI_FREE_CONFIRMED: "true", WORKERS_AI_ENABLED: "true" }).allowed, false);
});

test("daily limit parsing is safe and defaults to no additional cap", () => {
  assert.equal(dailyProviderCallLimit({}), 0);
  assert.equal(dailyProviderCallLimit({ CEOAI_FREE_DAILY_CALL_LIMIT: "25" }), 25);
  assert.equal(dailyProviderCallLimit({ CEOAI_FREE_DAILY_CALL_LIMIT: "-1" }), -1);
  assert.equal(dailyProviderCallLimit({ CEOAI_FREE_DAILY_CALL_LIMIT: "1e4" }), -1);
});

test("daily usage reserves calls and blocks once the configured cap is reached", async () => {
  const kv = new MemoryKV();
  const env = { CEOAI_FREE_DAILY_CALL_LIMIT: "2" };
  assert.equal((await reserveProviderCall(kv, "gemini-1", env, Date.UTC(2026, 0, 2))).allowed, true);
  assert.equal((await reserveProviderCall(kv, "gemini-1", env, Date.UTC(2026, 0, 2))).count, 2);
  assert.equal((await reserveProviderCall(kv, "gemini-1", env, Date.UTC(2026, 0, 2))).reason, "daily_limit_reached");
  assert.notEqual(dailyProviderUsageKey("gemini-1", Date.UTC(2026, 0, 2)), dailyProviderUsageKey("gemini-1", Date.UTC(2026, 0, 3)));
});

test("usage storage failures fail closed and expose no internal details", async () => {
  const kv = { async get() { throw new Error("secret internal detail"); }, async put() {} };
  const result = await reserveProviderCall(kv, "gemini-1", {}, Date.UTC(2026, 0, 2));
  assert.deepEqual(result, { allowed: false, reason: "usage_store_unavailable", count: null });
});


test("token estimate ledger records bounded daily estimates separately from provider-reported usage", async () => {
  const kv = new MemoryKV();
  const now = Date.UTC(2026, 0, 2);
  assert.equal(estimateTokenCount("12345678"), 2);
  assert.equal(estimateTokenCount(""), 0);
  const first = await recordProviderTokenEstimate(kv, "tokenharbor", "abcdefgh", "ijklmnop", now);
  assert.equal(first.recorded, true);
  assert.equal(first.estimatedInputTokens, 2);
  assert.equal(first.estimatedOutputTokens, 2);
  assert.equal(first.estimatedTotalTokens, 4);
  assert.equal(first.source, "character_heuristic");
  const second = await recordProviderTokenEstimate(kv, "tokenharbor", "abcd", "efgh", now);
  assert.equal(second.estimatedTotalTokens, 6);
  assert.equal(second.samples, 2);
  assert.equal(dailyTokenEstimateKey("tokenharbor", now), "free-token-estimate:v1:2026-01-02:tokenharbor");
  assert.equal((await recordProviderTokenEstimate(null, "tokenharbor", "x", "y", now)).recorded, false);
});
