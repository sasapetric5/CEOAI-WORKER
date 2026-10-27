// CEOAI V5.0 adaptive timeout and request-deadline budget.
// A provider attempt can never extend the overall request deadline.
export const DEFAULT_REQUEST_BUDGET_MS = 24_000;
export const MIN_ATTEMPT_BUDGET_MS = 2_000;
export const MIN_PROVIDER_TIMEOUT_MS = 4_000;
export const MAX_PROVIDER_TIMEOUT_MS = 15_000;
export const LATENCY_MULTIPLIER = 3;
export const LATENCY_SAFETY_MARGIN_MS = 1_000;

export function createRequestDeadline(now = Date.now(), budgetMs = DEFAULT_REQUEST_BUDGET_MS) {
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(budgetMs) ||
      budgetMs < MIN_ATTEMPT_BUDGET_MS || budgetMs > DEFAULT_REQUEST_BUDGET_MS) return null;
  return now + Math.floor(budgetMs);
}

export function remainingRequestBudget(deadlineAt, now = Date.now()) {
  if (!Number.isFinite(deadlineAt) || !Number.isFinite(now) || now < 0) return 0;
  return Math.max(0, Math.floor(deadlineAt - now));
}

export function adaptiveProviderTimeout(remainingMs, latencyEwmaMs = null) {
  if (!Number.isFinite(remainingMs) || remainingMs < MIN_ATTEMPT_BUDGET_MS) return 0;
  const latency = Number.isFinite(latencyEwmaMs) && latencyEwmaMs >= 1 && latencyEwmaMs <= 120_000
    ? latencyEwmaMs : null;
  const estimated = latency === null
    ? 8_000
    : Math.ceil(latency * LATENCY_MULTIPLIER + LATENCY_SAFETY_MARGIN_MS);
  const bounded = Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.min(MAX_PROVIDER_TIMEOUT_MS, estimated));
  return Math.min(Math.floor(remainingMs), bounded);
}

export function canStartProviderAttempt(remainingMs) {
  return Number.isFinite(remainingMs) && remainingMs >= MIN_ATTEMPT_BUDGET_MS;
}
