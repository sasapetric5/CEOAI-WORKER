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

export function dailyProviderCallLimit(env = {}) {
  const raw = env.CEOAI_FREE_DAILY_CALL_LIMIT;
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
  const limit = dailyProviderCallLimit(env);
  if (limit < 0) return { allowed: false, reason: "invalid_daily_limit", count: null };
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return { allowed: false, reason: "usage_store_unavailable", count: null };
  }
  const key = dailyProviderUsageKey(providerId, now);
  if (!key) return { allowed: false, reason: "invalid_provider_id", count: null };
  try {
    const raw = await kv.get(key);
    const count = raw === null || raw === undefined ? 0 : Number(raw);
    if (!Number.isSafeInteger(count) || count < 0) return { allowed: false, reason: "usage_state_invalid", count: null };
    if (limit > 0 && count >= limit) return { allowed: false, reason: "daily_limit_reached", count };
    const next = count + 1;
    await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 3 });
    return { allowed: true, reason: "reserved", count: next };
  } catch {
    return { allowed: false, reason: "usage_store_unavailable", count: null };
  }
}
