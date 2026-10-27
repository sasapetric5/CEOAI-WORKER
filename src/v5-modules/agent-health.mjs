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
    updatedAt: now,
  };
}

function validCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : 0;
}

export async function readProviderHealth(kv, providerId) {
  const key = keyFor(providerId);
  const raw = await kv.get(key, "json");
  if (!raw || typeof raw !== "object" || raw.provider !== providerId) return emptyHealth(providerId, Date.now());
  return {
    ...emptyHealth(providerId, Date.now()),
    ...raw,
    provider: providerId,
    attempts: validCounter(raw.attempts),
    successes: validCounter(raw.successes),
    failures: validCounter(raw.failures),
    consecutiveFailures: validCounter(raw.consecutiveFailures),
  };
}

export async function recordProviderOutcome(kv, providerId, outcome, now = Date.now()) {
  try {
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") return false;
    if (!Number.isFinite(now) || now < 0) return false;
    if (!outcome || !["success", "failure"].includes(outcome.kind)) return false;

    const key = keyFor(providerId);
    let previous;
    try { previous = await readProviderHealth(kv, providerId); }
    catch { previous = emptyHealth(providerId, now); }

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
