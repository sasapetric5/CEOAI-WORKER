// CEOAI V5.0 provider policy primitives inspired by health-aware gateway patterns.
// Pure functions only: safe to test without network calls or provider credentials.
export const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export function parseRetryAfterSeconds(value, nowMs = Date.now(), maxSeconds = MAX_RETRY_AFTER_SECONDS) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^[0-9]+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
    return Math.min(seconds, maxSeconds);
  }
  // Date.parse accepts non-HTTP strings such as "-1"; require an HTTP-date shape first.
  if (!/^[A-Za-z]{3}, [0-9]{2} [A-Za-z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(raw)) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const seconds = Math.ceil((at - nowMs) / 1000);
  if (seconds <= 0) return 0;
  return Math.min(seconds, maxSeconds);
}

export function providerFailureCooldown({ status = 0, quotaExhausted = false, retryAfterSeconds = null } = {}) {
  const code = Number(status) || 0;
  if (quotaExhausted) return { ttl: 6 * 60 * 60, reason: "quota_exhausted" };
  if (code === 429) {
    const hinted = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS)
      : 0;
    return { ttl: Math.max(60, hinted), reason: "rate_limited" };
  }
  if (code === 401 || code === 403) return { ttl: 60 * 60, reason: "provider_auth_or_policy" };
  if (code === 404) return { ttl: 6 * 60 * 60, reason: "provider_model_unavailable" };
  if (code >= 500) return { ttl: 5 * 60, reason: "provider_server_error" };
  if (code === 0) return { ttl: 60, reason: "provider_timeout_or_network" };
  return null;
}
