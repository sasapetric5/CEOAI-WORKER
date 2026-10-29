import test from "node:test";
import assert from "node:assert/strict";
import { reserveProviderCall, dailyProviderUsageKey, dailyProviderCallLimit, checkFreeQuotaEligibility } from "../src/v5-modules/provider-cost-guard.mjs";
import { createProviderRegistry, PROVIDER_REGISTRY, getProviderCapability, isRegisteredModelAllowed } from "../src/v5-modules/provider-registry.mjs";

const NOW = Date.UTC(2026, 9, 29, 18, 0, 0);
const ENV = { CEOAI_FREE_DAILY_CALL_LIMIT: "3" };

class MemoryKV {
  constructor() { this.data = new Map(); this.fail = false; }
  async get(key) {
    if (this.fail) throw new Error("private store detail");
    return this.data.has(key) ? this.data.get(key) : null;
  }
  async put(key, value) {
    if (this.fail) throw new Error("private store detail");
    this.data.set(key, String(value));
  }
}
class BarrierKV extends MemoryKV {
  constructor(parties) { super(); this.parties = parties; this.arrived = 0; this.release = null; this.gate = new Promise(resolve => { this.release = resolve; }); }
  async get(key) {
    this.arrived += 1;
    if (this.arrived === this.parties) this.release();
    await this.gate;
    return super.get(key);
  }
}

test("parallel quota reservations reveal the known non-atomic KV race (characterization)", async () => {
  const kv = new BarrierKV(20);
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveProviderCall(kv, "openrouter-1", { CEOAI_FREE_DAILY_CALL_LIMIT: "1" }, NOW)));
  // This intentionally documents the current limitation: every caller reads the same old value.
  assert.equal(results.filter(result => result.allowed).length, 20);
  assert.equal(kv.data.get(dailyProviderUsageKey("openrouter-1", NOW)), "1");
});

test("sequential reservations never exceed the configured cap", async () => {
  const kv = new MemoryKV();
  const results = [];
  for (let i = 0; i < 10; i++) results.push(await reserveProviderCall(kv, "openrouter-1", ENV, NOW));
  assert.equal(results.filter(x => x.allowed).length, 3);
  assert.equal(results.filter(x => x.reason === "daily_limit_reached").length, 7);
});

test("parallel reservations with pre-existing usage block once observed at the cap", async () => {
  const kv = new MemoryKV();
  kv.data.set(dailyProviderUsageKey("openrouter-1", NOW), "3");
  const results = await Promise.all(Array.from({ length: 10 }, () => reserveProviderCall(kv, "openrouter-1", ENV, NOW)));
  assert.ok(results.every(x => !x.allowed && x.reason === "daily_limit_reached"));
});

test("parallel reservations are denied if usage storage fails before reads complete", async () => {
  const kv = new MemoryKV(); kv.fail = true;
  const results = await Promise.all(Array.from({ length: 10 }, () => reserveProviderCall(kv, "openrouter-1", ENV, NOW)));
  assert.ok(results.every(x => !x.allowed && x.reason === "usage_store_unavailable"));
});

test("zero daily cap is a hard stop", async () => {
  const kv = new MemoryKV();
  const result = await reserveProviderCall(kv, "openrouter-1", { CEOAI_FREE_DAILY_CALL_LIMIT: "0" }, NOW);
  assert.deepEqual(result, { allowed: true, reason: "reserved", count: 1 });
});

test("invalid daily cap fails closed even when usage is empty", async () => {
  const result = await reserveProviderCall(new MemoryKV(), "openrouter-1", { CEOAI_FREE_DAILY_CALL_LIMIT: "-5" }, NOW);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "invalid_daily_limit");
});

test("provider-specific daily cap takes precedence over global cap", async () => {
  const kv = new MemoryKV();
  const env = { CEOAI_FREE_DAILY_CALL_LIMIT: "9", CEOAI_FREE_DAILY_CALL_LIMIT_OPENROUTER_1: "1" };
  assert.equal((await reserveProviderCall(kv, "openrouter-1", env, NOW)).allowed, true);
  assert.equal((await reserveProviderCall(kv, "openrouter-1", env, NOW)).reason, "daily_limit_reached");
});

test("different provider IDs maintain separate quota keys", async () => {
  const kv = new MemoryKV();
  assert.equal((await reserveProviderCall(kv, "openrouter-1", ENV, NOW)).allowed, true);
  assert.equal((await reserveProviderCall(kv, "gemini-1", ENV, NOW)).allowed, true);
  assert.equal(kv.data.get(dailyProviderUsageKey("openrouter-1", NOW)), "1");
  assert.equal(kv.data.get(dailyProviderUsageKey("gemini-1", NOW)), "1");
});

test("UTC day boundary creates a fresh quota ledger key", async () => {
  const kv = new MemoryKV();
  const before = Date.UTC(2026, 9, 29, 23, 59, 59);
  const after = before + 1000;
  await reserveProviderCall(kv, "gemini-1", { CEOAI_FREE_DAILY_CALL_LIMIT: "1" }, before);
  assert.equal((await reserveProviderCall(kv, "gemini-1", { CEOAI_FREE_DAILY_CALL_LIMIT: "1" }, after)).allowed, true);
});

test("provider usage key is not created for an invalid provider id", async () => {
  const result = await reserveProviderCall(new MemoryKV(), "../evil", ENV, NOW);
  assert.deepEqual(result, { allowed: false, reason: "invalid_provider_id", count: null });
});

test("free eligibility rejects null and primitive candidates", () => {
  for (const candidate of [null, undefined, "", 1, true]) assert.equal(checkFreeQuotaEligibility(candidate, {}).allowed, false);
});

test("free eligibility rejects unknown provider before checking keys", () => {
  assert.equal(checkFreeQuotaEligibility({ provider: "unknown", model: "x", key: "secret" }, {}).reason, "provider_not_allowlisted");
});

test("free eligibility rejects an unapproved model for a known provider", () => {
  assert.equal(checkFreeQuotaEligibility({ provider: "openrouter", model: "openai/gpt-4o", key: "test" }, { OPENROUTER_FREE_CONFIRMED: "true" }).reason, "model_not_allowlisted");
});

test("free eligibility rejects missing confirmation even with a key", () => {
  assert.equal(checkFreeQuotaEligibility({ provider: "openrouter", model: "openai/gpt-oss-20b:free", key: "test" }, {}).reason, "free_tier_not_confirmed");
});

test("provider registry rejects duplicate definitions", () => {
  const def = { id: "demo", adapter: "demo-adapter", confirmationEnv: "DEMO_FREE_CONFIRMED", keyRequired: true, modelRule: "openrouter", capabilities: ["fast"], quotaMode: "local-counter" };
  assert.throws(() => createProviderRegistry([def, def]), TypeError);
});

test("provider registry rejects malformed provider IDs", () => {
  const base = { id: "valid", adapter: "demo-adapter", confirmationEnv: "DEMO_FREE_CONFIRMED", keyRequired: true, modelRule: "openrouter", capabilities: ["fast"], quotaMode: "local-counter" };
  for (const id of ["", "../escape", "bad id", "x".repeat(81)]) assert.throws(() => createProviderRegistry([{ ...base, id }]), TypeError);
});

test("provider registry rejects malformed adapters and confirmation variables", () => {
  const base = { id: "valid", adapter: "demo-adapter", confirmationEnv: "DEMO_FREE_CONFIRMED", keyRequired: true, modelRule: "openrouter", capabilities: ["fast"], quotaMode: "local-counter" };
  assert.throws(() => createProviderRegistry([{ ...base, adapter: "../bad" }]), TypeError);
  assert.throws(() => createProviderRegistry([{ ...base, confirmationEnv: "bad-name" }]), TypeError);
});

test("provider registry rejects unsupported capabilities and quota modes", () => {
  const base = { id: "valid", adapter: "demo-adapter", confirmationEnv: "DEMO_FREE_CONFIRMED", keyRequired: true, modelRule: "openrouter", capabilities: ["fast"], quotaMode: "local-counter" };
  assert.throws(() => createProviderRegistry([{ ...base, capabilities: ["shell"] }]), TypeError);
  assert.throws(() => createProviderRegistry([{ ...base, quotaMode: "unlimited" }]), TypeError);
});

test("provider registry model allowlist rejects whitespace and unknown models", () => {
  assert.equal(isRegisteredModelAllowed("openrouter", " openai/gpt-oss-20b:free "), true);
  assert.equal(isRegisteredModelAllowed("openrouter", ""), false);
  assert.equal(isRegisteredModelAllowed("openrouter", "openai/gpt-4o"), false);
});

test("provider capability results cannot mutate registry-owned capability arrays", () => {
  const cap = getProviderCapability("openrouter");
  cap.capabilities.push("shell");
  assert.equal(getProviderCapability("openrouter").capabilities.includes("shell"), false);
});

test("provider registry list results cannot mutate registry-owned capabilities", () => {
  const list = PROVIDER_REGISTRY.list();
  list[0].capabilities.push("shell");
  assert.equal(PROVIDER_REGISTRY.list()[0].capabilities.includes("shell"), false);
});

test("registry model check fails closed for unknown provider", () => {
  assert.equal(PROVIDER_REGISTRY.isModelAllowed("unknown", "model:free"), false);
});

test("registry has a single known entry for every listed provider", () => {
  for (const entry of PROVIDER_REGISTRY.list()) {
    assert.equal(PROVIDER_REGISTRY.has(entry.id), true);
    assert.equal(PROVIDER_REGISTRY.get(entry.id).id, entry.id);
  }
});

test("registry capabilities are restricted to known capability names", () => {
  for (const entry of PROVIDER_REGISTRY.list()) {
    assert.ok(entry.capabilities.every(cap => ["fast", "coding", "reasoning", "research", "complex"].includes(cap)));
  }
});

test("provider registry rejects invalid model rule names", () => {
  const def = { id: "valid", adapter: "demo-adapter", confirmationEnv: "DEMO_FREE_CONFIRMED", keyRequired: true, modelRule: "not-a-rule", capabilities: ["fast"], quotaMode: "local-counter" };
  assert.throws(() => createProviderRegistry([def]), TypeError);
});

test("registry preserves explicit free-tier confirmation gates on all built-in providers", () => {
  for (const entry of PROVIDER_REGISTRY.list()) {
    assert.ok(entry.confirmationEnv.endsWith("_FREE_CONFIRMED"), entry.id);
  }
});

test("registry keeps unknown provider IDs denied by default", () => {
  assert.equal(getProviderCapability("unlisted-agent-provider"), null);
  assert.equal(isRegisteredModelAllowed("unlisted-agent-provider", "model"), false);
});
