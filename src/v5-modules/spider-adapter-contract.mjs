// Spider sidecar contract for CEOAI V5.0.
// This module only builds/validates JSON messages. It does not spawn Spider,
// make network requests, resolve DNS, or enable any external runtime.

import { validateCrawlTarget, validateCrawlRecord, deduplicateCrawlRecords } from "./web-intelligence.mjs";

const MAX_URLS_PER_JOB = 10;
const MAX_CONCURRENCY = 2;
const MAX_TIMEOUT_MS = 15_000;
const MAX_RECORDS_PER_RESULT = 100;
const MAX_EVIDENCE_ITEMS = 8;

function validJobId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

export function createSpiderJobRequest(input = {}, options = {}) {
  const errors = [];
  if (!validJobId(input.job_id)) errors.push("invalid-job-id");
  if (!Array.isArray(input.urls) || input.urls.length === 0) errors.push("urls-required");
  else if (input.urls.length > MAX_URLS_PER_JOB) errors.push("url-limit-exceeded");

  const approvedHosts = options.approvedHosts ?? [];
  const targets = Array.isArray(input.urls)
    ? input.urls.map(url => validateCrawlTarget(url, approvedHosts))
    : [];
  if (targets.some(target => !target.allowed)) errors.push("one-or-more-urls-not-approved");

  const concurrency = Number.isInteger(input.concurrency) ? input.concurrency : 1;
  if (concurrency < 1 || concurrency > MAX_CONCURRENCY) errors.push("concurrency-out-of-range");

  const timeoutMs = Number.isInteger(input.timeout_ms) ? input.timeout_ms : 10_000;
  if (timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) errors.push("timeout-out-of-range");

  if (input.browser_mode === true) errors.push("browser-mode-disabled-in-initial-pilot");
  if (input.follow_links === true) errors.push("link-following-disabled-in-initial-pilot");

  if (errors.length) return { accepted: false, errors, request: null };

  return {
    accepted: true,
    errors: [],
    request: {
      protocol: "ceoai-spider/1",
      job_id: input.job_id,
      adapter_id: "spider",
      urls: targets.map(target => target.canonical_url),
      concurrency,
      timeout_ms: timeoutMs,
      browser_mode: false,
      follow_links: false,
      obey_robots_txt: true,
      respect_retry_after: true,
      max_records: MAX_RECORDS_PER_RESULT,
      external_actions: false,
      paid_services: false,
    },
  };
}

export function validateSpiderJobResult(result, options = {}) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { accepted: false, errors: ["result-must-be-object"], records: [] };
  }
  if (result.protocol !== "ceoai-spider/1") errors.push("protocol-mismatch");
  if (!validJobId(result.job_id)) errors.push("invalid-job-id");
  if (result.adapter_id !== "spider") errors.push("adapter-id-mismatch");
  if (!Array.isArray(result.records)) errors.push("records-must-be-array");
  else if (result.records.length > MAX_RECORDS_PER_RESULT) errors.push("record-limit-exceeded");
  if (result.external_actions !== false) errors.push("external-actions-must-be-disabled");
  if (result.paid_services !== false) errors.push("paid-services-must-be-disabled");

  if (errors.length) return { accepted: false, errors, records: [] };

  const validated = result.records.map(record => validateCrawlRecord(record, options));
  const rejectedCount = validated.filter(item => !item.accepted).length;
  const acceptedRecords = validated.filter(item => item.accepted).map(item => ({
    ...item.record,
    evidence: item.record.evidence.slice(0, MAX_EVIDENCE_ITEMS),
    adapter_id: "spider",
    job_id: result.job_id,
  }));

  return {
    accepted: rejectedCount === 0,
    errors: rejectedCount ? ["one-or-more-records-failed-provenance-validation"] : [],
    rejected_count: rejectedCount,
    records: deduplicateCrawlRecords(acceptedRecords),
    verification_status: "awaiting-independent-confirmation",
    execution_status: "sidecar-result-validated",
  };
}

export const SPIDER_PILOT_LIMITS = Object.freeze({
  maxUrlsPerJob: MAX_URLS_PER_JOB,
  maxConcurrency: MAX_CONCURRENCY,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxRecordsPerResult: MAX_RECORDS_PER_RESULT,
  browserMode: false,
  followLinks: false,
  paidServices: false,
  externalActions: false,
});
