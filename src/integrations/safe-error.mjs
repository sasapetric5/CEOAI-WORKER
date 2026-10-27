/**
 * Convert integration failures to stable, non-sensitive public errors.
 * Never echo upstream response bodies, exception messages, URLs, or credentials.
 */
const SAFE_CODES = new Set([
  "INTEGRATION_TIMEOUT",
  "INTEGRATION_UNAVAILABLE",
  "INTEGRATION_INVALID_RESPONSE",
  "INTEGRATION_NOT_CONFIGURED",
  "INTEGRATION_NOT_IMPLEMENTED",
  "INTEGRATION_RATE_LIMITED",
]);

export function safeIntegrationError(input, fallback = "INTEGRATION_UNAVAILABLE") {
  const allowedFallback = SAFE_CODES.has(fallback) ? fallback : "INTEGRATION_UNAVAILABLE";
  if (!input || typeof input !== "object") return { ok: false, code: allowedFallback };
  const code = typeof input.code === "string" && SAFE_CODES.has(input.code)
    ? input.code
    : null;
  if (input.name === "AbortError" || input.name === "TimeoutError") {
    return { ok: false, code: "INTEGRATION_TIMEOUT" };
  }
  if (input.status === 429) return { ok: false, code: "INTEGRATION_RATE_LIMITED" };
  if (input.status === 408 || input.status === 504) {
    return { ok: false, code: "INTEGRATION_TIMEOUT" };
  }
  return { ok: false, code: code ?? allowedFallback };
}

export function safeIntegrationHttpStatus(status) {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { ok: false, code: "INTEGRATION_INVALID_RESPONSE" };
  }
  if (status === 429) return { ok: false, code: "INTEGRATION_RATE_LIMITED" };
  if (status === 408 || status === 504) return { ok: false, code: "INTEGRATION_TIMEOUT" };
  if (status < 200 || status >= 300) return { ok: false, code: "INTEGRATION_UNAVAILABLE" };
  return { ok: true, code: "INTEGRATION_OK" };
}
