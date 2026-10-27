// CEOAI V5.0 latency-aware routing primitives.
// Latency is advisory only: capability fit, cooldown, and circuit policy remain authoritative.
export const LATENCY_MIN_SAMPLE_MS = 1;
export const LATENCY_MAX_SAMPLE_MS = 120_000;
export const LATENCY_EWMA_ALPHA = 0.3;
export const LATENCY_ROUTING_WINDOW_MS = 60 * 60 * 1000;
export const LATENCY_MAX_ADJUSTMENT = 0.25;

export function normalizeLatencyMs(value) {
  return Number.isFinite(value) && value >= LATENCY_MIN_SAMPLE_MS && value <= LATENCY_MAX_SAMPLE_MS
    ? Math.round(value)
    : null;
}

export function nextLatencyEwma(previousMs, sampleMs, alpha = LATENCY_EWMA_ALPHA) {
  const sample = normalizeLatencyMs(sampleMs);
  if (sample === null) return normalizeLatencyMs(previousMs);
  const previous = normalizeLatencyMs(previousMs);
  const weight = Number.isFinite(alpha) && alpha > 0 && alpha <= 1 ? alpha : LATENCY_EWMA_ALPHA;
  if (previous === null) return sample;
  return Math.round(previous * (1 - weight) + sample * weight);
}

// Bounded tie-breaker: never overrides a meaningful capability-score difference.
// Under 1.5s earns +0.25, >=15s earns -0.25, with linear interpolation between.
export function providerLatencyRoutingAdjustment(health, now = Date.now()) {
  if (!health || typeof health !== "object" || !Number.isFinite(now)) return 0;
  const updatedAt = Number(health.updatedAt);
  const latency = normalizeLatencyMs(health.latencyEwmaMs);
  if (latency === null || !Number.isFinite(updatedAt) || updatedAt > now ||
      now - updatedAt > LATENCY_ROUTING_WINDOW_MS) return 0;
  const fastMs = 1500;
  const slowMs = 15000;
  const ratio = Math.max(0, Math.min(1, (latency - fastMs) / (slowMs - fastMs)));
  return Number((LATENCY_MAX_ADJUSTMENT * (1 - 2 * ratio)).toFixed(3));
}
