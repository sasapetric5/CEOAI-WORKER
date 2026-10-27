// Stable, privacy-safe provider failure classification. Never return raw error messages.
import { providerFailureCooldown } from "./provider-policy.mjs";

export function classifyProviderFailure({ status = 0, quotaExhausted = false, retryAfterSeconds = null, message = "" } = {}) {
  const numeric = Number(status);
  const code = Number.isInteger(numeric) && numeric >= 0 && numeric <= 599 ? numeric : 0;
  const text = typeof message === "string" ? message.toLowerCase() : "";
  let classification;
  if (quotaExhausted) classification = "quota_exhausted";
  else if (code === 429) classification = "rate_limited";
  else if (code === 401 || code === 403) classification = "auth_or_policy";
  else if (code === 404) classification = "model_unavailable";
  else if (code >= 500 && code <= 599) classification = "server_error";
  else if (code === 408 || code === 504 || /timeout|timed out|aborterror/.test(text)) classification = "timeout";
  else if (code === 0) classification = "network_error";
  else if (/prazan odgovor|empty response/.test(text)) classification = "empty_response";
  else if (code >= 400 && code <= 499) classification = "request_error";
  else classification = "unknown";
  const cooldown = providerFailureCooldown({ status: code, quotaExhausted, retryAfterSeconds });
  const retryable = ["network_error", "timeout", "server_error", "empty_response"].includes(classification);
  return { classification, retryable, cooldownReason: cooldown?.reason ?? null, cooldownSeconds: cooldown?.ttl ?? 0 };
}
