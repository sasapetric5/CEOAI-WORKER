// Provider credential monitoring coordinator.
// It calls only code-owned adapters registered for known provider IDs.
// It never accepts URLs, cookies, arbitrary fetch callbacks from user input, or raw provider responses.
import { isKnownProvider } from "./provider-catalog.mjs";
import { assessCredentialLifecycle, CREDENTIAL_STATUS } from "./provider-key-lifecycle.mjs";

const ALLOWED_REMOTE_STATES = new Set(["active", "invalid", "revoked", "quota_exhausted", "rate_limited", "unknown"]);
const ALLOWED_META = new Set(["status", "expiresAt", "lastCheckedAt", "quotaResetAt", "createdAt", "updatedAt", "label", "source"]);

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function safeAdapterResult(value) {
  if (!plain(value) || !ALLOWED_REMOTE_STATES.has(value.status)) {
    return { status: "unknown", expiresAt: null, quota: null };
  }
  const expiresAt = value.expiresAt === undefined ? null : value.expiresAt;
  if (expiresAt !== null && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)))) {
    return { status: "unknown", expiresAt: null, quota: null };
  }
  let quota = null;
  if (value.quota !== undefined && value.quota !== null) {
    if (!plain(value.quota)) return { status: "unknown", expiresAt: null, quota: null };
    const remaining = value.quota.remaining ?? value.quota.remainingUsd ?? null;
    if (remaining !== null && (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0)) {
      return { status: "unknown", expiresAt: null, quota: null };
    }
    const resetAt = value.quota.resetAt ?? null;
    if (resetAt !== null && (typeof resetAt !== "string" || !Number.isFinite(Date.parse(resetAt)))) {
      return { status: "unknown", expiresAt: null, quota: null };
    }
    quota = {};
    if (remaining !== null) quota.remaining = remaining;
    if (resetAt !== null) quota.resetAt = resetAt;
  }
  return { status: value.status, expiresAt, quota };
}

export async function runCredentialMonitor({
  credentialRefs,
  vault,
  adapters,
  now = Date.now(),
  maxChecks = 10,
  maxCheckAgeMs = 24 * 60 * 60 * 1000
} = {}) {
  if (!Array.isArray(credentialRefs) || credentialRefs.length > 100) throw new TypeError("INVALID_CREDENTIAL_REFERENCE_LIST");
  if (!vault || typeof vault.get !== "function" || typeof vault.getMetadata !== "function" || typeof vault.put !== "function") {
    throw new TypeError("CREDENTIAL_VAULT_REQUIRED");
  }
  if (!plain(adapters)) throw new TypeError("CODE_OWNED_PROVIDER_ADAPTERS_REQUIRED");
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 25) throw new TypeError("INVALID_MONITOR_CHECK_BUDGET");
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("INVALID_MONITOR_CLOCK");

  const seen = new Set();
  const results = [];
  let checks = 0;
  for (const ref of credentialRefs) {
    if (!plain(ref) || typeof ref.providerId !== "string" || typeof ref.credentialId !== "string" ||
        !isKnownProvider(ref.providerId) || !/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(ref.credentialId)) {
      results.push({ providerId: "unknown", credentialId: "redacted", status: CREDENTIAL_STATUS.UNKNOWN, action: "invalid_reference" });
      continue;
    }
    const refKey = ref.providerId + ":" + ref.credentialId;
    if (seen.has(refKey)) continue;
    seen.add(refKey);

    let metadata;
    try {
      metadata = await vault.getMetadata(ref);
    } catch {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: CREDENTIAL_STATUS.UNKNOWN, action: "metadata_unavailable" });
      continue;
    }
    if (!metadata) {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: CREDENTIAL_STATUS.UNKNOWN, action: "credential_not_registered" });
      continue;
    }

    const initial = assessCredentialLifecycle({
      providerStatus: metadata.status ?? "unknown",
      expiresAt: metadata.expiresAt ?? null,
      lastCheckedAt: metadata.lastCheckedAt ?? null,
      quota: metadata.quotaResetAt ? { resetAt: metadata.quotaResetAt } : null
    }, { now, maxCheckAgeMs });

    if (initial.status === CREDENTIAL_STATUS.EXPIRED ||
        initial.status === CREDENTIAL_STATUS.QUOTA_EXHAUSTED ||
        initial.status === CREDENTIAL_STATUS.REVOKED ||
        initial.status === CREDENTIAL_STATUS.INVALID) {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: initial.status, action: initial.action });
      continue;
    }
    if (initial.status !== CREDENTIAL_STATUS.CHECK_DUE) {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: initial.status, action: initial.action });
      continue;
    }
    if (checks >= maxChecks) {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: CREDENTIAL_STATUS.CHECK_DUE, action: "check_budget_deferred" });
      continue;
    }

    const adapter = adapters[ref.providerId];
    if (!adapter || typeof adapter.checkCredential !== "function") {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: CREDENTIAL_STATUS.UNKNOWN, action: "official_read_only_adapter_unavailable" });
      continue;
    }

    let secret;
    try {
      secret = await vault.get(ref);
      if (typeof secret !== "string" || secret.length < 8) throw new Error("MISSING_SECRET");
    } catch {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: CREDENTIAL_STATUS.UNKNOWN, action: "credential_unavailable" });
      continue;
    }

    checks += 1;
    let signal;
    try {
      // The adapter is a code-owned module for this provider; caller data cannot supply a URL.
      signal = safeAdapterResult(await adapter.checkCredential({ apiKey: secret, credentialId: ref.credentialId }));
    } catch {
      signal = { status: "unknown", expiresAt: null, quota: null };
    } finally {
      secret = null;
    }

    const updatedAt = new Date(now).toISOString();
    const nextMetadata = {
      status: signal.status,
      lastCheckedAt: updatedAt,
      updatedAt
    };
    if (signal.expiresAt !== null) nextMetadata.expiresAt = signal.expiresAt;
    if (signal.quota?.resetAt) nextMetadata.quotaResetAt = signal.quota.resetAt;

    try {
      const existingSecret = await vault.get(ref);
      if (typeof existingSecret !== "string") throw new Error("MISSING_SECRET");
      await vault.put({ ...ref, secret: existingSecret, metadata: nextMetadata });
    } catch {
      results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: CREDENTIAL_STATUS.UNKNOWN, action: "status_persist_failed" });
      continue;
    }

    const assessed = assessCredentialLifecycle({
      providerStatus: signal.status,
      expiresAt: signal.expiresAt,
      lastCheckedAt: now,
      quota: signal.quota
    }, { now, maxCheckAgeMs });
    results.push({ providerId: ref.providerId, credentialId: ref.credentialId, status: assessed.status, action: assessed.action });
  }

  return {
    checked: checks,
    deferred: results.filter(item => item.action === "check_budget_deferred").length,
    results
  };
}
