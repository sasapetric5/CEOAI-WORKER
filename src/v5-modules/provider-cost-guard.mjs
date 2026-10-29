// CEOAI V5.0: registry-backed fail-closed free-tier eligibility and best-effort daily call accounting.
// The registry is the single source of truth for registered providers and safe model policies.
import { getProviderCapability, isRegisteredModelAllowed } from "./provider-registry.mjs";

export function isFreeModelAllowed(provider, model) {
  return isRegisteredModelAllowed(provider, model);
}

export function checkFreeQuotaEligibility(candidate, env = {}) {
  if (!candidate || typeof candidate !== "object") return { allowed: false, reason: "invalid_candidate" };
  const provider = candidate.provider;
  const capability = getProviderCapability(provider);
  if (!capability) return { allowed: false, reason: "provider_not_allowlisted" };
  if (!isFreeModelAllowed(provider, candidate.model)) return { allowed: false, reason: "model_not_allowlisted" };
  if (env[capability.confirmationEnv] !== "true") return { allowed: false, reason: "free_tier_not_confirmed" };
  if (!capability.keyRequired) {
    if (!env.AI || env.WORKERS_AI_ENABLED !== "true") return { allowed: false, reason: "workers_ai_disabled" };
  } else if (typeof candidate.key !== "string" || !candidate.key.trim()) {
    return { allowed: false, reason: "provider_key_missing" };
  }
  return { allowed: true, reason: "free_tier_confirmed" };
}

export function dailyProviderCallLimit(env = {}, providerId = "") {
  const suffix = typeof providerId === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(providerId)
    ? providerId.toUpperCase().replace(/-/g, "_") : "";
  const specific = suffix ? env["CEOAI_FREE_DAILY_CALL_LIMIT_" + suffix] : undefined;
  const raw = specific !== undefined && specific !== null && specific !== "" ? specific : env.CEOAI_FREE_DAILY_CALL_LIMIT;
  if (raw === undefined || raw === null || raw === "") return 0;
  if (!/^[0-9]{1,7}$/.test(String(raw))) return -1;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

export function dailyProviderUsageKey(providerId, now = Date.now()) {
  if (typeof providerId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(providerId) ||
      !Number.isFinite(now) || now < 0) return null;
  return `free-usage:v1:${new Date(now).toISOString().slice(0, 10)}:${providerId}`;
}

// KV is eventually consistent; this is a best-effort circuit guard, not an atomic distributed quota.
export async function reserveProviderCall(kv, providerId, env = {}, now = Date.now()) {
  const limit = dailyProviderCallLimit(env, providerId);
  if (limit < 0) return { allowed: false, reason: "invalid_daily_limit", count: null };
  if (limit === 0) return { allowed: false, reason: "daily_limit_not_configured_or_zero", count: 0 };
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return { allowed: false, reason: "usage_store_unavailable", count: null };
  }
  const key = dailyProviderUsageKey(providerId, now);
  if (!key) return { allowed: false, reason: "invalid_provider_id", count: null };
  try {
    const raw = await kv.get(key);
    const count = raw === null || raw === undefined ? 0 : Number(raw);
    if (!Number.isSafeInteger(count) || count < 0) return { allowed: false, reason: "usage_state_invalid", count: null };
    if (count >= limit) return { allowed: false, reason: "daily_limit_reached", count };
    const next = count + 1;
    await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 3 });
    return { allowed: true, reason: "reserved", count: next };
  } catch {
    return { allowed: false, reason: "usage_store_unavailable", count: null };
  }
}


function textForTokenEstimate(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value ?? ""); } catch { return ""; }
}

// Heuristic only: roughly four characters per token. Never present this as provider-reported usage.
export function estimateTokenCount(value) {
  const text = textForTokenEstimate(value);
  if (!text) return 0;
  return Math.min(10_000_000, Math.ceil(text.length / 4));
}

export function dailyTokenEstimateKey(providerId, now = Date.now()) {
  const usageKey = dailyProviderUsageKey(providerId, now);
  return usageKey ? usageKey.replace("free-usage:v1:", "free-token-estimate:v1:") : null;
}

// Diagnostic daily estimates. Provider-reported usage, when available, should take precedence.
export async function recordProviderTokenEstimate(kv, providerId, input, output, now = Date.now()) {
  try {
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
      return { recorded: false, reason: "usage_store_unavailable" };
    }
    const key = dailyTokenEstimateKey(providerId, now);
    if (!key) return { recorded: false, reason: "invalid_provider_id" };
    const inputTokens = estimateTokenCount(input);
    const outputTokens = estimateTokenCount(output);
    let previous = null;
    try { previous = await kv.get(key, "json"); } catch { previous = null; }
    if (typeof previous === "string") {
      try { previous = JSON.parse(previous); } catch { previous = null; }
    }
    if (!previous || typeof previous !== "object" || Array.isArray(previous) || previous.provider !== providerId) previous = {};
    const safe = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : 0;
    const next = {
      provider: providerId,
      estimatedInputTokens: Math.min(1_000_000_000, safe(previous.estimatedInputTokens) + inputTokens),
      estimatedOutputTokens: Math.min(1_000_000_000, safe(previous.estimatedOutputTokens) + outputTokens),
      estimatedTotalTokens: Math.min(1_000_000_000, safe(previous.estimatedTotalTokens) + inputTokens + outputTokens),
      samples: Math.min(1_000_000_000, safe(previous.samples) + 1),
      updatedAt: now,
      source: "character_heuristic",
    };
    await kv.put(key, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 35 });
    return { recorded: true, ...next };
  } catch {
    return { recorded: false, reason: "usage_store_unavailable" };
  }
}
