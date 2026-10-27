// CEOAI V5.0: fail-closed free-tier eligibility and best-effort daily call accounting.
// This prevents accidental use of unapproved/non-free models; it cannot guarantee a provider's live quota.
const FREE_CONFIRMATION_ENV = Object.freeze({
  "workers-ai": "WORKERS_AI_FREE_CONFIRMED",
  "glm-flash": "ZAI_GLM_FLASH_FREE_CONFIRMED",
  gemini: "GEMINI_FREE_CONFIRMED",
  openrouter: "OPENROUTER_FREE_CONFIRMED",
  deepseek: "DEEPSEEK_FREE_CONFIRMED",
  mistral: "MISTRAL_FREE_CONFIRMED",
  xai: "XAI_FREE_CONFIRMED",
  nvidia: "NVIDIA_FREE_CONFIRMED",
  huggingface: "HF_FREE_CONFIRMED",
});

export function isFreeModelAllowed(provider, model) {
  if (typeof provider !== "string" || typeof model !== "string" || !model.trim()) return false;
  const name = model.trim();
  switch (provider) {
    case "openrouter": return /^[A-Za-z0-9._/-]{1,180}:free$/.test(name);
    case "mistral": return ["open-mistral-nemo", "mistral-small-latest", "ministral-8b-latest"].includes(name);
    case "workers-ai": return name.startsWith("@cf/");
    case "glm-flash": return /^[A-Za-z0-9._-]{1,80}$/.test(name);
    case "gemini": return /^gemini-[A-Za-z0-9.-]+$/.test(name);
    case "deepseek": return name === "deepseek-chat" || name === "deepseek-reasoner";
    case "xai": return /^[A-Za-z0-9._-]{1,80}$/.test(name);
    case "nvidia": return /^[A-Za-z0-9._/-]{1,120}$/.test(name);
    case "huggingface": return /^[A-Za-z0-9._/-]{1,120}$/.test(name);
    default: return false;
  }
}

export function checkFreeQuotaEligibility(candidate, env = {}) {
  if (!candidate || typeof candidate !== "object") return { allowed: false, reason: "invalid_candidate" };
  const provider = candidate.provider;
  const confirmationName = FREE_CONFIRMATION_ENV[provider];
  if (!confirmationName) return { allowed: false, reason: "provider_not_allowlisted" };
  if (!isFreeModelAllowed(provider, candidate.model)) return { allowed: false, reason: "model_not_allowlisted" };
  if (env[confirmationName] !== "true") return { allowed: false, reason: "free_tier_not_confirmed" };
  if (provider === "workers-ai") {
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
