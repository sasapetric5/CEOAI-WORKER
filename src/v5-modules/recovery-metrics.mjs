// CEOAI V5.0 recovery metrics — bounded aggregate counters, best-effort only.
// No prompts, replies, user/session IDs, API keys, or raw errors are stored.
// KV read/modify/write is not atomic across Worker isolates; metrics are diagnostic.
const METRICS_KEY = "recovery:metrics:v1";
const METRICS_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_COUNTER = 1_000_000_000;
const EVENTS = new Set([
  "provider_failure",
  "circuit_open_skip",
  "half_open_probe",
  "failover_success",
  "recovered_request",
]);

function emptyMetrics(now) {
  return {
    version: 1,
    providerFailures: 0,
    circuitOpenSkips: 0,
    halfOpenProbes: 0,
    failoverSuccesses: 0,
    recoveredRequests: 0,
    lastEventAt: now,
  };
}

function safeCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, MAX_COUNTER) : 0;
}

export async function readRecoveryMetrics(kv) {
  if (!kv || typeof kv.get !== "function") return null;
  try {
    const raw = await kv.get(METRICS_KEY, "json");
    if (!raw || typeof raw !== "object" || raw.version !== 1) return emptyMetrics(Date.now());
    const now = Date.now();
    const lastEventAt = Number.isSafeInteger(raw.lastEventAt) && raw.lastEventAt >= 0 && raw.lastEventAt <= now + 60_000
      ? raw.lastEventAt : now;
    const base = emptyMetrics(lastEventAt);
    for (const field of ["providerFailures", "circuitOpenSkips", "halfOpenProbes", "failoverSuccesses", "recoveredRequests"]) {
      base[field] = safeCounter(raw[field]);
    }
    return base;
  } catch {
    return null;
  }
}

export async function recordRecoveryMetric(kv, event, now = Date.now()) {
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function" ||
      !EVENTS.has(event) || !Number.isFinite(now) || now < 0) return false;
  try {
    const previous = await readRecoveryMetrics(kv);
    // A failed read is not the same as an empty store: do not overwrite counters.
    if (!previous) return false;
    const fields = {
      provider_failure: "providerFailures",
      circuit_open_skip: "circuitOpenSkips",
      half_open_probe: "halfOpenProbes",
      failover_success: "failoverSuccesses",
      recovered_request: "recoveredRequests",
    };
    const field = fields[event];
    const next = {
      ...previous,
      [field]: Math.min(MAX_COUNTER, previous[field] + 1),
      lastEventAt: now,
    };
    await kv.put(METRICS_KEY, JSON.stringify(next), { expirationTtl: METRICS_TTL_SECONDS });
    return true;
  } catch {
    // Metrics must never interrupt provider routing or a successful chat response.
    return false;
  }
}

export const RECOVERY_METRICS_KEY = METRICS_KEY;
export const RECOVERY_METRICS_TTL_SECONDS = METRICS_TTL_SECONDS;
