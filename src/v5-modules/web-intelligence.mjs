// CEOAI Web Intelligence: provenance and source-admission boundary.
// This module validates crawler output; it does not fetch URLs or execute crawler code.
// A source is approved only when its exact hostname is explicitly configured by the owner.

const SHA256_RE = /^[a-f0-9]{64}$/i;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".test", ".invalid"];
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function parseHost(value) {
  const host = String(value ?? "").trim().toLowerCase().replace(/\\.$/, "");
  if (!host || host.includes("/") || host.includes("@") || host.includes(":")) return null;
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) return null;
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
  if (host.includes("..")) return null;
  // Literal IPs are intentionally excluded; approved sources must be named DNS hosts.
  if (/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(host) || host.includes(":")) return null;
  return host;
}

export function parseApprovedSourceHosts(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(entries.map(parseHost).filter(Boolean))].sort();
}

export function validateCrawlTarget(inputUrl, approvedHosts) {
  let url;
  try {
    url = new URL(String(inputUrl));
  } catch {
    return { allowed: false, reason: "invalid-url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { allowed: false, reason: "scheme-not-allowed" };
  }
  if (url.username || url.password) return { allowed: false, reason: "url-credentials-forbidden" };
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { allowed: false, reason: "nonstandard-port-forbidden" };
  }
  const hostname = parseHost(url.hostname);
  if (!hostname) return { allowed: false, reason: "hostname-not-public-dns-name" };
  const approved = parseApprovedSourceHosts(approvedHosts);
  if (!approved.includes(hostname)) return { allowed: false, reason: "source-host-not-approved" };
  url.hash = "";
  return {
    allowed: true,
    hostname,
    canonical_url: url.toString(),
    reason: null,
  };
}

export function validateCrawlRecord(record, options = {}) {
  const reasons = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { accepted: false, reasons: ["record-must-be-object"], record: null };
  }

  const target = validateCrawlTarget(record.source_url, options.approvedHosts ?? []);
  if (!target.allowed) reasons.push(target.reason);

  const status = record.http_status;
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    reasons.push("http-status-not-successful");
  }
  if (record.robots_allowed !== true) reasons.push("robots-permission-not-confirmed");

  const collectedAt = typeof record.collected_at === "string" ? Date.parse(record.collected_at) : NaN;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!Number.isFinite(collectedAt)) reasons.push("collection-timestamp-invalid");
  else if (collectedAt > now + MAX_FUTURE_SKEW_MS) reasons.push("collection-timestamp-in-future");

  if (typeof record.content_hash !== "string" || !SHA256_RE.test(record.content_hash)) {
    reasons.push("content-hash-must-be-sha256");
  }
  if (typeof record.extractor !== "string" || !record.extractor.trim()) {
    reasons.push("extractor-required");
  }
  if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    reasons.push("extracted-data-must-be-object");
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    reasons.push("evidence-required");
  }

  if (reasons.length) return { accepted: false, reasons, record: null };

  const normalized = {
    source_url: target.canonical_url,
    source_host: target.hostname,
    collected_at: new Date(collectedAt).toISOString(),
    http_status: status,
    robots_allowed: true,
    extractor: record.extractor.trim(),
    content_hash: record.content_hash.toLowerCase(),
    evidence: record.evidence.map(item => String(item).slice(0, 2000)),
    data: record.data,
    source_status: "approved-source",
    verification_status: "awaiting-independent-confirmation",
    external_actions: false,
    paid_services: false,
  };
  return { accepted: true, reasons: [], record: normalized };
}

export function deduplicateCrawlRecords(records = []) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  const seen = new Set();
  const output = [];
  for (const record of records) {
    if (!record || typeof record.source_url !== "string" || typeof record.content_hash !== "string") continue;
    const key = record.source_url + "\\n" + record.content_hash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(record);
  }
  return output;
}
