import test from "node:test";
import assert from "node:assert/strict";
import { getProviderDefinition, listProviderDefinitions } from "../src/credentials/provider-catalog.mjs";
import { assessCredentialLifecycle, classifyProviderSignal, CREDENTIAL_STATUS, planCredentialRotation } from "../src/credentials/provider-key-lifecycle.mjs";

const now = Date.UTC(2026, 10, 5, 12, 0, 0);
const day = 24 * 60 * 60 * 1000;

test("catalog includes only the two reviewed official providers and no key material", () => {
  const catalog = listProviderDefinitions();
  assert.deepEqual(catalog.map(p => p.id).sort(), ["bytez", "nvidia_build"]);
  for (const provider of catalog) {
    assert.equal(Object.hasOwn(provider, "apiKey"), false);
    assert.equal(Object.hasOwn(provider, "secret"), false);
    assert.equal(provider.acquisition.automaticSignup, false);
    assert.equal(provider.freeUse.paidUpgradeAllowed, false);
  }
});

test("NVIDIA key catalog reflects dashboard-managed expiry and rotation", () => {
  const provider = getProviderDefinition("nvidia_build");
  assert.equal(provider.lifecycle.personalKeyLimit, 8);
  assert.equal(provider.lifecycle.rotationSupportedInDashboard, true);
  assert.equal(provider.lifecycle.secretShownOnlyAtCreation, true);
  assert.equal(provider.acquisition.publicKeyIssuanceApiVerified, false);
  assert.equal(provider.authentication.scheme, "bearer");
});

test("Bytez catalog enforces free-only account controls", () => {
  const provider = getProviderDefinition("bytez");
  assert.equal(provider.freeUse.initialCreditsUsd, 1);
  assert.equal(provider.freeUse.freeCreditRefreshDays, undefined);
  assert.equal(provider.freeUse.autoReloadAllowed, false);
  assert.equal(provider.freeUse.autoScaleAllowed, false);
  assert.equal(provider.freeUse.paymentMethodAllowed, false);
  assert.equal(provider.lifecycle.freeCreditRefreshDays, 28);
  assert.equal(provider.lifecycle.freeCreditExpiryDays, 28);
  assert.equal(provider.authentication.scheme, "raw_key");
});

test("unknown providers cannot enter credential rotation", () => {
  assert.deepEqual(planCredentialRotation({ providerId: "unknown", status: "expired", ownerAuthorized: true }), {
    action: "blocked", code: "UNKNOWN_PROVIDER"
  });
});

test("rotation fails closed without explicit owner authorization", () => {
  assert.equal(planCredentialRotation({ providerId: "nvidia_build", status: "expired" }).code, "OWNER_AUTHORIZATION_REQUIRED");
});

test("active credentials are not rotated unnecessarily", () => {
  assert.equal(planCredentialRotation({ providerId: "bytez", status: "active", ownerAuthorized: true }).action, "no_action");
});

test("expiring credentials require owner portal rotation and keep old credential", () => {
  const plan = planCredentialRotation({ providerId: "nvidia_build", status: "expiring", ownerAuthorized: true });
  assert.equal(plan.action, "owner_portal_rotation_required");
  assert.equal(plan.requiresOwnerSession, true);
  assert.equal(plan.revokeOldCredentialBeforeReplacement, false);
  assert.equal(plan.bypassMfaOrCaptcha, false);
});

test("replacement activation is two-phase and never revokes old key before verification", () => {
  const pending = planCredentialRotation({ providerId: "nvidia_build", status: "expired", ownerAuthorized: true, replacementStaged: true });
  assert.equal(pending.action, "verify_replacement");
  assert.equal(pending.keepOldCredential, true);
  const verified = planCredentialRotation({ providerId: "nvidia_build", status: "expired", ownerAuthorized: true, replacementStaged: true, replacementVerified: true });
  assert.equal(verified.action, "activate_replacement");
  assert.equal(verified.revokeOldOnlyAfterSwitch, true);
});

test("expired credentials are detected without assuming provider key expiry", () => {
  assert.equal(assessCredentialLifecycle({ providerStatus: "active", expiresAt: now - 1, lastCheckedAt: now }, { now }).status, CREDENTIAL_STATUS.EXPIRED);
  assert.equal(assessCredentialLifecycle({ providerStatus: "active", expiresAt: null, lastCheckedAt: now }, { now }).status, CREDENTIAL_STATUS.ACTIVE);
});

test("expiring credentials enter warning window", () => {
  const result = assessCredentialLifecycle({ providerStatus: "active", expiresAt: now + 10 * day, lastCheckedAt: now }, { now });
  assert.equal(result.status, CREDENTIAL_STATUS.EXPIRING);
  assert.equal(result.usable, true);
});

test("stale provider status must be checked again", () => {
  const result = assessCredentialLifecycle({ providerStatus: "active", lastCheckedAt: now - 2 * day }, { now });
  assert.equal(result.status, CREDENTIAL_STATUS.CHECK_DUE);
  assert.equal(result.usable, false);
});

test("unknown provider check never becomes active by default", () => {
  const result = assessCredentialLifecycle({ lastCheckedAt: now }, { now });
  assert.equal(result.status, CREDENTIAL_STATUS.UNKNOWN);
});

test("zero quota triggers fallback or reset wait without any paid action", () => {
  const result = assessCredentialLifecycle({ providerStatus: "active", lastCheckedAt: now, quota: { remainingUsd: 0, resetAt: now + 7 * day } }, { now });
  assert.equal(result.status, CREDENTIAL_STATUS.QUOTA_EXHAUSTED);
  assert.equal(result.nextAvailableAt, now + 7 * day);
  assert.equal(planCredentialRotation({ providerId: "bytez", status: result.status, ownerAuthorized: true }).action, "owner_portal_rotation_required");
});

test("credential status rejects invalid timestamps, quota and policy input", () => {
  assert.throws(() => assessCredentialLifecycle({ expiresAt: "someday" }, { now }), /INVALID_CREDENTIAL_EXPIRY/);
  assert.throws(() => assessCredentialLifecycle({ quota: { remaining: -1 } }, { now }), /INVALID_QUOTA_REMAINING/);
  assert.throws(() => assessCredentialLifecycle({}, { now, expiryWarningDays: 999 }), /INVALID_LIFECYCLE_CLOCK_OR_POLICY/);
});

test("401 and 403 are authentication or access failures, not quota renewals", () => {
  assert.equal(classifyProviderSignal({ status: 401 }).status, CREDENTIAL_STATUS.INVALID);
  assert.equal(classifyProviderSignal({ status: 403 }).status, CREDENTIAL_STATUS.INVALID);
});

test("Bytez 402 insufficient credits does not trigger automatic top-up", () => {
  const signal = classifyProviderSignal({ status: 402, message: "Insufficient credits. Please add credits to continue." });
  assert.equal(signal.status, CREDENTIAL_STATUS.QUOTA_EXHAUSTED);
  assert.equal(signal.paidAction, false);
});

test("ordinary 429 rate limit is not mistaken for monthly quota exhaustion", () => {
  const signal = classifyProviderSignal({ status: 429, message: "Too many requests" });
  assert.equal(signal.status, CREDENTIAL_STATUS.RATE_LIMITED);
  assert.equal(signal.retryable, true);
});

test("provider errors never authorize paid retries or automatic payment", () => {
  for (const status of [402, 403, 429, 500, 503]) {
    assert.equal(classifyProviderSignal({ status, message: "test" }).paidAction, false);
  }
});
