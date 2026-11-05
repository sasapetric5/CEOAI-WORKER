// Deterministic credential lifecycle policy. No network calls or secret values are handled here.
import { getProviderDefinition } from "./provider-catalog.mjs";

export const CREDENTIAL_STATUS = Object.freeze({
  ACTIVE: "active",
  EXPIRING: "expiring",
  EXPIRED: "expired",
  INVALID: "invalid",
  REVOKED: "revoked",
  QUOTA_EXHAUSTED: "quota_exhausted",
  RATE_LIMITED: "rate_limited",
  CHECK_DUE: "check_due",
  UNKNOWN: "unknown"
});

const plain = value => value !== null && typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function timeValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function assessCredentialLifecycle({
  providerStatus = "unknown",
  expiresAt = null,
  lastCheckedAt = null,
  quota = null
} = {}, {
  now = Date.now(),
  expiryWarningDays = 14,
  maxCheckAgeMs = 24 * 60 * 60 * 1000
} = {}) {
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(expiryWarningDays) || expiryWarningDays < 0 || expiryWarningDays > 365 ||
      !Number.isSafeInteger(maxCheckAgeMs) || maxCheckAgeMs < 0) {
    throw new TypeError("INVALID_LIFECYCLE_CLOCK_OR_POLICY");
  }
  if (!["unknown", "active", "invalid", "revoked", "rate_limited", "quota_exhausted"].includes(providerStatus)) {
    throw new TypeError("INVALID_PROVIDER_CREDENTIAL_STATUS");
  }
  if (!plain(quota) && quota !== null) throw new TypeError("INVALID_QUOTA_METADATA");

  if (providerStatus === "revoked") return { status: CREDENTIAL_STATUS.REVOKED, usable: false, action: "replace_or_reauthorize" };
  if (providerStatus === "invalid") return { status: CREDENTIAL_STATUS.INVALID, usable: false, action: "owner_reauthorization_required" };
  if (providerStatus === "quota_exhausted") return { status: CREDENTIAL_STATUS.QUOTA_EXHAUSTED, usable: false, action: "wait_for_reset_or_select_fallback" };
  if (providerStatus === "rate_limited") return { status: CREDENTIAL_STATUS.RATE_LIMITED, usable: false, action: "respect_retry_after_or_select_fallback" };

  if (quota) {
    const remaining = quota.remaining ?? quota.remainingUsd ?? null;
    if (remaining !== null && (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0)) {
      throw new TypeError("INVALID_QUOTA_REMAINING");
    }
    if (remaining === 0) {
      const resetAt = timeValue(quota.resetAt);
      return {
        status: CREDENTIAL_STATUS.QUOTA_EXHAUSTED,
        usable: false,
        nextAvailableAt: resetAt,
        action: resetAt && resetAt > now ? "wait_for_reset_or_select_fallback" : "refresh_quota_status"
      };
    }
  }

  const expiry = timeValue(expiresAt);
  if (expiresAt !== null && expiresAt !== undefined && expiry === null) {
    throw new TypeError("INVALID_CREDENTIAL_EXPIRY");
  }
  if (expiry !== null && expiry <= now) {
    return { status: CREDENTIAL_STATUS.EXPIRED, usable: false, expiresAt: expiry, action: "owner_portal_rotation_required" };
  }
  if (expiry !== null && expiry - now <= expiryWarningDays * 24 * 60 * 60 * 1000) {
    return { status: CREDENTIAL_STATUS.EXPIRING, usable: true, expiresAt: expiry, action: "schedule_rotation_before_expiry" };
  }

  const checked = timeValue(lastCheckedAt);
  if (lastCheckedAt !== null && lastCheckedAt !== undefined && checked === null) {
    throw new TypeError("INVALID_CREDENTIAL_CHECK_TIME");
  }
  if (checked === null || now - checked > maxCheckAgeMs) {
    return { status: CREDENTIAL_STATUS.CHECK_DUE, usable: false, lastCheckedAt: checked, action: "check_using_official_provider_signal" };
  }
  if (providerStatus !== "active") {
    return { status: CREDENTIAL_STATUS.UNKNOWN, usable: false, lastCheckedAt: checked, action: "provider_status_unknown" };
  }
  return { status: CREDENTIAL_STATUS.ACTIVE, usable: true, expiresAt: expiry, lastCheckedAt: checked, action: "none" };
}

export function planCredentialRotation({
  providerId,
  status,
  ownerAuthorized = false,
  replacementStaged = false,
  replacementVerified = false
} = {}) {
  const provider = getProviderDefinition(providerId);
  if (!provider) return { action: "blocked", code: "UNKNOWN_PROVIDER" };
  if (ownerAuthorized !== true) return { action: "blocked", code: "OWNER_AUTHORIZATION_REQUIRED" };

  const rotationDue = [CREDENTIAL_STATUS.EXPIRING, CREDENTIAL_STATUS.EXPIRED,
    CREDENTIAL_STATUS.INVALID, CREDENTIAL_STATUS.REVOKED, CREDENTIAL_STATUS.QUOTA_EXHAUSTED].includes(status);
  if (!rotationDue) return { action: "no_action", code: "ROTATION_NOT_REQUIRED" };

  if (replacementStaged) {
    if (!replacementVerified) {
      return { action: "verify_replacement", code: "REPLACEMENT_NOT_VERIFIED", keepOldCredential: true };
    }
    return {
      action: "activate_replacement",
      code: "REPLACEMENT_READY",
      keepOldCredential: true,
      revokeOldOnlyAfterSwitch: true
    };
  }

  return {
    action: "owner_portal_rotation_required",
    code: "PROVIDER_PORTAL_ROTATION_ONLY",
    portalUrl: provider.keyManagementUrl,
    requiresOwnerSession: true,
    automaticSignup: false,
    bypassMfaOrCaptcha: false,
    revokeOldCredentialBeforeReplacement: false
  };
}

export function classifyProviderSignal({ status, code = "", message = "" } = {}) {
  if (!Number.isInteger(status) || status < 0 || status > 599) {
    return { status: CREDENTIAL_STATUS.UNKNOWN, retryable: false, paidAction: false };
  }
  const detail = (String(code) + " " + String(message)).toLowerCase();
  if (status === 401) return { status: CREDENTIAL_STATUS.INVALID, retryable: false, paidAction: false };
  if (status === 403) return { status: CREDENTIAL_STATUS.INVALID, retryable: false, paidAction: false };
  if (status === 402 && /insufficient credits|credit balance|payment required/.test(detail)) {
    return { status: CREDENTIAL_STATUS.QUOTA_EXHAUSTED, retryable: false, paidAction: false };
  }
  if (status === 429) return { status: CREDENTIAL_STATUS.RATE_LIMITED, retryable: true, paidAction: false };
  if (status >= 500) return { status: CREDENTIAL_STATUS.UNKNOWN, retryable: true, paidAction: false };
  if (status >= 200 && status < 300) return { status: CREDENTIAL_STATUS.ACTIVE, retryable: false, paidAction: false };
  return { status: CREDENTIAL_STATUS.UNKNOWN, retryable: false, paidAction: false };
}
