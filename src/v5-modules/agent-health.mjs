// CEOAI V5.0 Agent Health Monitor — best-effort, privacy-safe provider health summaries.
// KV read/modify/write is not atomic; counters are diagnostic, never used as a security boundary.
const HEALTH_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_PROVIDER_ID_LENGTH = 80;

function keyFor(providerId) {
  const id = String(providerId || "");
  if (!/^[a-z0-9._-]{1,80}$/i.test(id) || id.length > MAX_PROVIDER_ID_LENGTH) {
    throw new TypeError("Invalid provider ID");
  }
  return `health:provider:${id}`;
}

function emptyHealth(providerId, now) {
  return {
    provider: providerId,
    status: "unknown",
    attempts: 0,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastOutcomeAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastStatusCode: null,
    lastFailureClass: null,
    updatedAt: now,
  };
}

function validCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : 0;
}

export async function readProviderHealth(kv, providerId) {
  const key = keyFor(providerId);
  const now = Date.now();
  const raw = await kv.get(key, "json");
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.provider !== providerId) {
    return emptyHealth(providerId, now);
  }

  // Treat KV as untrusted persisted input: only expose known, bounded fields.
  const allowedStatuses = new Set(["unknown", "healthy", "rate_limited", "unavailable", "degraded"]);
  const safeTimestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= now + 60_000 ? value : null;
  const persistedUpdatedAt = safeTimestamp(raw.updatedAt);
  const result = {
    ...emptyHealth(providerId, now),
    status: persistedUpdatedAt !== null && allowedStatuses.has(raw.status) ? raw.status : "unknown",
    attempts: validCounter(raw.attempts),
    successes: validCounter(raw.successes),
    failures: validCounter(raw.failures),
    consecutiveFailures: validCounter(raw.consecutiveFailures),
    lastOutcomeAt: safeTimestamp(raw.lastOutcomeAt),
    lastSuccessAt: safeTimestamp(raw.lastSuccessAt),
    lastFailureAt: safeTimestamp(raw.lastFailureAt),
    lastStatusCode: Number.isInteger(raw.lastStatusCode) && raw.lastStatusCode >= 100 && raw.lastStatusCode <= 599
      ? raw.lastStatusCode : null,
    lastFailureClass: typeof raw.lastFailureClass === "string" && /^[a-z0-9_-]{1,80}$/i.test(raw.lastFailureClass)
      ? raw.lastFailureClass : null,
    updatedAt: persistedUpdatedAt ?? now,
  };
  if (Number.isFinite(raw.latencyEwmaMs) && raw.latencyEwmaMs >= 1 && raw.latencyEwmaMs <= 120_000) {
    result.latencyEwmaMs = Math.round(raw.latencyEwmaMs);
  }
  if (Number.isSafeInteger(raw.latencySamples) && raw.latencySamples >= 0) {
    result.latencySamples = Math.min(raw.latencySamples, 1_000_000_000);
  }
  return result;
}

export async function recordProviderLatency(kv, providerId, durationMs, now = Date.now()) {
  try {
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function" ||
        !Number.isFinite(now) || now < 0 || !Number.isFinite(durationMs) ||
        durationMs < 1 || durationMs > 120_000) return false;
    const key = keyFor(providerId);
    let previous;
    try { previous = await readProviderHealth(kv, providerId); }
    catch { return false; }
    const oldLatency = Number.isFinite(previous.latencyEwmaMs) &&
      previous.latencyEwmaMs >= 1 && previous.latencyEwmaMs <= 120_000
      ? previous.latencyEwmaMs : null;
    const latencyEwmaMs = oldLatency === null
      ? Math.round(durationMs)
      : Math.round(oldLatency * 0.7 + durationMs * 0.3);
    const next = { ...previous, latencyEwmaMs, latencySamples: Math.min(1_000_000_000,
      (Number.isSafeInteger(previous.latencySamples) && previous.latencySamples >= 0 ? previous.latencySamples : 0) + 1),
      updatedAt: now };
    await kv.put(key, JSON.stringify(next), { expirationTtl: HEALTH_TTL_SECONDS });
    return true;
  } catch {
    // Latency telemetry is advisory and must never break provider routing.
    return false;
  }
}

export async function recordProviderOutcome(kv, providerId, outcome, now = Date.now()) {
  try {
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") return false;
    if (!Number.isFinite(now) || now < 0) return false;
    if (!outcome || !["success", "failure"].includes(outcome.kind)) return false;

    const key = keyFor(providerId);
    let previous;
    try { previous = await readProviderHealth(kv, providerId); }
    catch { return false; }

    const success = outcome.kind === "success";
    const statusCode = Number.isInteger(outcome.statusCode) && outcome.statusCode >= 100 && outcome.statusCode <= 599
      ? outcome.statusCode : null;
    const next = {
      ...previous,
      provider: providerId,
      status: success ? "healthy" : (statusCode === 429 ? "rate_limited" : statusCode >= 500 ? "unavailable" : "degraded"),
      attempts: Math.min(1_000_000_000, previous.attempts + 1),
      successes: Math.min(1_000_000_000, previous.successes + (success ? 1 : 0)),
      failures: Math.min(1_000_000_000, previous.failures + (success ? 0 : 1)),
      consecutiveFailures: success ? 0 : Math.min(1_000_000_000, previous.consecutiveFailures + 1),
      lastOutcomeAt: now,
      lastSuccessAt: success ? now : previous.lastSuccessAt,
      lastFailureAt: success ? previous.lastFailureAt : now,
      lastStatusCode: success ? 200 : statusCode,
      lastFailureClass: success ? null : (typeof outcome.failureClass === "string" ? outcome.failureClass : null),
      updatedAt: now,
    };
    await kv.put(key, JSON.stringify(next), { expirationTtl: HEALTH_TTL_SECONDS });
    return true;
  } catch {
    // Monitoring must never break chat or cause an otherwise successful provider call to fail.
    return false;
  }
}

export const PROVIDER_HEALTH_TTL_SECONDS = HEALTH_TTL_SECONDS;
