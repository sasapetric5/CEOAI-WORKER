// Health-aware routing adjustments. Capability ranking remains primary; health is a bounded tie-breaker.
const RECENT_HEALTH_WINDOW_MS = 60 * 60 * 1000;

export function providerHealthRoutingAdjustment(health, now = Date.now()) {
  if (!health || typeof health !== "object" || !Number.isFinite(now)) return 0;
  const updatedAt = Number(health.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt < 0 || now - updatedAt > RECENT_HEALTH_WINDOW_MS || updatedAt > now) return 0;
  if (health.status === "healthy" && Number(health.consecutiveFailures) === 0) return 0.2;
  const failures = Number.isSafeInteger(health.consecutiveFailures) && health.consecutiveFailures > 0
    ? Math.min(3, health.consecutiveFailures) : 1;
  if (health.status === "unavailable") return -0.1 * failures;
  if (health.status === "rate_limited") return -0.15 * failures;
  if (health.status === "degraded") return -0.05 * failures;
  return 0;
}

export function providerRecoveryAction(health, now = Date.now()) {
  if (!health || typeof health !== "object" || !Number.isFinite(now)) return "normal";
  const updatedAt = Number(health.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt > now || now - updatedAt > RECENT_HEALTH_WINDOW_MS) return "normal";
  if (health.status === "healthy" && Number(health.consecutiveFailures) === 0) return "recovered";
  if (health.status === "unavailable" || health.status === "rate_limited") return "probe_after_cooldown";
  return "normal";
}
