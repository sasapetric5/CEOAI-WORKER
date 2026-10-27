/**
 * Normalize Lychee JSON output into a bounded, secret-safe CEOAI result.
 * This module does not execute Lychee, fetch URLs, or call an external service.
 */
const MAX_REPORT_BYTES = 2_000_000;
const MAX_FAILURES = 500;
const MAX_URL_LENGTH = 2048;
const MAX_TEXT_LENGTH = 300;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    // Query strings and fragments may contain credentials or private tracking data.
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function safeText(value) {
  if (typeof value !== "string") return null;
  return value
    .replace(/[\\u0000-\\u001f\\u007f]/g, " ")
    .replace(/\\bBearer\\s+[A-Za-z0-9._~+\\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\\b(token|api[_-]?key|access[_-]?token|password|secret)\\s*[:=]\\s*[^\\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH) || null;
}

function parseStatus(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, 40);
  if (typeof value === "string") return safeText(value);
  if (isRecord(value)) {
    const candidate = value.code ?? value.status ?? value.text;
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate).slice(0, 40);
  }
  return null;
}

/**
 * Accepts parsed JSON or a JSON string. Returns a normalized report or a stable error code.
 * Unknown upstream fields are ignored; raw upstream messages and arbitrary objects are never echoed.
 */
export function normalizeLycheeReport(input, options = {}) {
  const maxFailures = Number.isSafeInteger(options.maxFailures) && options.maxFailures >= 0
    ? Math.min(options.maxFailures, MAX_FAILURES) : MAX_FAILURES;

  let report = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_REPORT_BYTES) {
      return { ok: false, code: "LYCHEE_REPORT_TOO_LARGE" };
    }
    try { report = JSON.parse(input); } catch {
      return { ok: false, code: "LYCHEE_REPORT_INVALID_JSON" };
    }
  } else if (input === null || typeof input !== "object") {
    return { ok: false, code: "LYCHEE_REPORT_INVALID_SHAPE" };
  }

  if (!isRecord(report)) return { ok: false, code: "LYCHEE_REPORT_INVALID_SHAPE" };

  const failMap = report.fail_map ?? report.failMap ?? {};
  if (!isRecord(failMap)) return { ok: false, code: "LYCHEE_REPORT_INVALID_FAILURES" };

  const failures = [];
  let malformedFailures = 0;
  let totalFailureEntries = 0;

  for (const [mapKey, entries] of Object.entries(failMap)) {
    if (!Array.isArray(entries)) {
      malformedFailures++;
      continue;
    }
    for (const entry of entries) {
      totalFailureEntries++;
      if (totalFailureEntries > 100_000) return { ok: false, code: "LYCHEE_REPORT_TOO_MANY_FAILURES" };
      if (!isRecord(entry)) {
        malformedFailures++;
        continue;
      }
      const url = safeUrl(entry.url ?? entry.uri ?? mapKey);
      if (!url) {
        malformedFailures++;
        continue;
      }
      if (failures.length < maxFailures) {
        failures.push({
          url,
          status: parseStatus(entry.status ?? entry.status_code ?? entry.error),
          message: safeText(entry.message ?? entry.reason ?? entry.error?.message),
        });
      }
    }
  }

  const total = safeCount(report.total);
  const successful = safeCount(report.successful ?? report.success);
  const reportedFailed = safeCount(report.failed);
  const failed = reportedFailed ?? safeCount(report.failures) ?? totalFailureEntries;

  if (total !== null && successful !== null && successful > total) {
    return { ok: false, code: "LYCHEE_REPORT_INCONSISTENT_COUNTS" };
  }
  if (total !== null && failed !== null && failed > total) {
    return { ok: false, code: "LYCHEE_REPORT_INCONSISTENT_COUNTS" };
  }

  return {
    ok: true,
    source: "LYCHEE_JSON",
    summary: {
      total,
      successful,
      failed,
      failureEntries: totalFailureEntries,
      returnedFailures: failures.length,
      truncatedFailures: Math.max(0, totalFailureEntries - failures.length),
      malformedFailures,
    },
    failures,
  };
}
