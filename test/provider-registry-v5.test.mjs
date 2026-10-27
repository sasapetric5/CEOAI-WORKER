import test from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_REGISTRY, createProviderRegistry, getProviderCapability, isRegisteredModelAllowed } from "../src/v5-modules/provider-registry.mjs";

test("built-in registry covers current AI providers and publishes capability metadata", () => {
  const providers = PROVIDER_REGISTRY.list();
  assert.equal(providers.length, 9);
  assert.ok(providers.every(p => p.id && p.adapter && p.confirmationEnv && p.quotaMode));
  assert.deepEqual(getProviderCapability("openrouter").capabilities, ["fast","coding","reasoning","complex"]);
  assert.equal(getProviderCapability("missing-provider"), null);
});

test("registered provider model policy denies paid, malformed, and unknown models", () => {
  assert.equal(isRegisteredModelAllowed("openrouter", "meta-llama/llama-3:free"), true);
  assert.equal(isRegisteredModelAllowed("openrouter", "openai/gpt-4o"), false);
  assert.equal(isRegisteredModelAllowed("workers-ai", "@cf/meta/llama-3-8b-instruct"), true);
  assert.equal(isRegisteredModelAllowed("workers-ai", "paid-model"), false);
  assert.equal(isRegisteredModelAllowed("unregistered", "model"), false);
});

test("registry extensions require valid explicit adapter and known safe model policy", () => {
  const registry = createProviderRegistry([{
    id:"test-provider", adapter:"openai-compatible", confirmationEnv:"TEST_PROVIDER_FREE_CONFIRMED",
    keyRequired:true, modelRule:"openrouter", capabilities:["coding"], quotaMode:"local-counter",
  }]);
  assert.equal(registry.has("test-provider"), true);
  assert.equal(registry.isModelAllowed("test-provider", "org/model:free"), true);
  assert.equal(registry.isModelAllowed("test-provider", "org/model"), false);
  assert.throws(() => createProviderRegistry([{ id:"test-provider", adapter:"openai-compatible" }]), /Invalid or duplicate/);
  assert.throws(() => createProviderRegistry([
    { id:"test-provider", adapter:"openai-compatible", confirmationEnv:"TEST_FREE", keyRequired:true, modelRule:"openrouter", capabilities:[], quotaMode:"none" },
    { id:"test-provider", adapter:"openai-compatible", confirmationEnv:"TEST_FREE", keyRequired:true, modelRule:"openrouter", capabilities:[], quotaMode:"none" },
  ]), /Invalid or duplicate/);
});
