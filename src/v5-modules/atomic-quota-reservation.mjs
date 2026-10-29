// CEOAI V5.0 — atomic quota reservation adapter.
// A KV read/modify/write is NOT atomic. This adapter requires a coordinator that
// implements an atomic reserve operation (for example, a Durable Object). It fails
// closed when the binding, response, or result is invalid.
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const MAX_LIMIT = 1_000_000;

export async function reserveAtomicDailyQuota(coordinator, providerId, limit, now = Date.now()) {
  if (typeof providerId !== "string" || !ID_RE.test(providerId)) {
    return { allowed: false, reason: "invalid_provider_id", count: null };
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { allowed: false, reason: "invalid_daily_limit", count: null };
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    return { allowed: false, reason: "invalid_timestamp", count: null };
  }
  if (!coordinator || typeof coordinator.fetch !== "function") {
    return { allowed: false, reason: "atomic_quota_backend_unavailable", count: null };
  }
  const day = new Date(now).toISOString().slice(0, 10);
  try {
    const response = await coordinator.fetch("https://ceoai.internal/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId, day, limit }),
    });
    if (!response || response.status !== 200 || typeof response.json !== "function") {
      return { allowed: false, reason: "atomic_quota_backend_invalid_response", count: null };
    }
    const result = await response.json();
    if (!result || typeof result !== "object" || typeof result.allowed !== "boolean" ||
        !Number.isSafeInteger(result.count) || result.count < 0) {
      return { allowed: false, reason: "atomic_quota_backend_invalid_result", count: null };
    }
    if (result.allowed && result.count > limit) {
      return { allowed: false, reason: "atomic_quota_backend_limit_violation", count: null };
    }
    return {
      allowed: result.allowed,
      reason: result.allowed ? "reserved" : "daily_limit_reached",
      count: result.count,
    };
  } catch {
    return { allowed: false, reason: "atomic_quota_backend_unavailable", count: null };
  }
}
