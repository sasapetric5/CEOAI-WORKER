// CEOAI V5.0 provider circuit-breaker policy.
// Complements existing KV cooldowns: only repeated transient failures open the circuit.
// KV health is advisory and eventual; this is not a distributed lock or quota/security boundary.
export const PROVIDER_CIRCUIT_FAILURE_THRESHOLD = 3;
export const PROVIDER_CIRCUIT_OPEN_MS = 5 * 60 * 1000;

export function providerCircuitDecision(health, now = Date.now(), {
  failureThreshold = PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  openMs = PROVIDER_CIRCUIT_OPEN_MS,
} = {}) {
  if (!health || typeof health !== "object" || !Number.isFinite(now) || now < 0) {
    return { state: "closed", consecutiveFailures: 0, retryInMs: 0 };
  }
  const failures = Number.isSafeInteger(health.consecutiveFailures) && health.consecutiveFailures >= 0
    ? health.consecutiveFailures : 0;
  const statusCode = Number.isInteger(health.lastStatusCode) ? health.lastStatusCode : null;
  // Do not duplicate quota (429), auth/policy (401/403), or model (404) cooldown policy.
  const knownClass = typeof health.lastFailureClass === "string" ? health.lastFailureClass : null;
  const transient = knownClass
    ? ["network_error", "timeout", "server_error", "empty_response"].includes(knownClass)
    : (statusCode === null || statusCode === 0 || (statusCode >= 500 && statusCode <= 599));
  const lastFailureAt = Number(health.lastFailureAt);
  if (failures < failureThreshold || !transient || !Number.isFinite(lastFailureAt) ||
      lastFailureAt < 0 || lastFailureAt > now) {
    return { state: "closed", consecutiveFailures: failures, retryInMs: 0 };
  }
  const elapsed = now - lastFailureAt;
  if (elapsed < openMs) {
    return { state: "open", consecutiveFailures: failures, retryInMs: openMs - elapsed };
  }
  return { state: "half_open", consecutiveFailures: failures, retryInMs: 0 };
}
