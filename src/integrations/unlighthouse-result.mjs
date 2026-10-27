/**
 * Normalize one Lighthouse JSON report (including Unlighthouse-wrapped reports).
 * Local-only parser: it does not launch a browser, fetch URLs, or call an external service.
 */
const MAX_REPORT_BYTES = 5_000_000;
const MAX_TEXT_LENGTH = 240;
const MAX_URL_LENGTH = 2048;
const CATEGORY_IDS = ["performance", "accessibility", "best-practices", "seo"];
const METRIC_IDS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "speed-index",
  "total-blocking-time",
  "cumulative-layout-shift",
  "interactive",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value) {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH) || null;
}

function safeUrl(value) {
  if (typeof value !== "string" || !value || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function safeScore(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? Math.round(value * 100) : null;
}

/**
 * Returns a small allowlisted summary or a stable error code.
 * Arbitrary Lighthouse fields, stack traces, query strings, and fragments are never returned.
 */
export function normalizeUnlighthouseReport(input) {
  let report = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_REPORT_BYTES) {
      return { ok: false, code: "UNLIGHTHOUSE_REPORT_TOO_LARGE" };
    }
    try {
      report = JSON.parse(input);
    } catch {
      return { ok: false, code: "UNLIGHTHOUSE_REPORT_INVALID_JSON" };
    }
  } else if (!isRecord(input)) {
    return { ok: false, code: "UNLIGHTHOUSE_REPORT_INVALID_SHAPE" };
  }

  if (!isRecord(report)) return { ok: false, code: "UNLIGHTHOUSE_REPORT_INVALID_SHAPE" };
  // Some wrappers place the native Lighthouse object under lighthouseResult.
  const lighthouse = isRecord(report.lighthouseResult) ? report.lighthouseResult : report;
  if (!isRecord(lighthouse.categories) || !isRecord(lighthouse.audits)) {
    return { ok: false, code: "UNLIGHTHOUSE_REPORT_INVALID_SHAPE" };
  }

  const requestedUrl = safeUrl(lighthouse.requestedUrl ?? lighthouse.finalDisplayedUrl ?? lighthouse.finalUrl);
  const finalUrl = safeUrl(lighthouse.finalDisplayedUrl ?? lighthouse.finalUrl ?? lighthouse.requestedUrl);
  const categories = {};
  for (const id of CATEGORY_IDS) {
    const category = lighthouse.categories[id];
    if (isRecord(category)) {
      categories[id] = {
        score: safeScore(category.score),
        title: safeText(category.title),
      };
    }
  }

  const metrics = {};
  for (const id of METRIC_IDS) {
    const audit = lighthouse.audits[id];
    if (!isRecord(audit)) continue;
    const numericValue = typeof audit.numericValue === "number" && Number.isFinite(audit.numericValue) && audit.numericValue >= 0
      ? Math.round(audit.numericValue * 100) / 100 : null;
    metrics[id] = {
      score: safeScore(audit.score),
      numericValue,
      displayValue: safeText(audit.displayValue),
      title: safeText(audit.title),
    };
  }

  const version = safeText(lighthouse.lighthouseVersion);
  const fetchTime = safeText(lighthouse.fetchTime);
  return {
    ok: true,
    source: "LIGHTHOUSE_JSON",
    requestedUrl,
    finalUrl,
    lighthouseVersion: version,
    fetchTime,
    categories,
    metrics,
  };
}
