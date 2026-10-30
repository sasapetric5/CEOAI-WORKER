import test from "node:test";
import assert from "node:assert/strict";
import {
  createSpiderJobRequest,
  validateSpiderJobResult,
  SPIDER_PILOT_LIMITS,
} from "../src/v5-modules/spider-adapter-contract.mjs";

const approvedHosts = ["example.org", "data.gov.rs"];
const validRecord = (overrides = {}) => ({
  source_url: "https://example.org/data",
  collected_at: "2026-10-30T12:00:00.000Z",
  http_status: 200,
  robots_allowed: true,
  extractor: "spider-local",
  content_hash: "b".repeat(64),
  evidence: ["Source page excerpt"],
  data: { label: "test", value: 7 },
  ...overrides,
});

test("Spider pilot contract has conservative free-only limits", () => {
  assert.equal(SPIDER_PILOT_LIMITS.maxUrlsPerJob, 10);
  assert.equal(SPIDER_PILOT_LIMITS.maxConcurrency, 2);
  assert.equal(SPIDER_PILOT_LIMITS.browserMode, false);
  assert.equal(SPIDER_PILOT_LIMITS.followLinks, false);
  assert.equal(SPIDER_PILOT_LIMITS.paidServices, false);
});

test("creates a bounded Spider request for explicitly approved hosts", () => {
  const result = createSpiderJobRequest({
    job_id: "pilot_001",
    urls: ["https://example.org/data", "https://data.gov.rs/open"],
    concurrency: 2,
    timeout_ms: 12000,
  }, { approvedHosts });
  assert.equal(result.accepted, true);
  assert.equal(result.request.protocol, "ceoai-spider/1");
  assert.deepEqual(result.request.urls, [
    "https://example.org/data",
    "https://data.gov.rs/open",
  ]);
  assert.equal(result.request.obey_robots_txt, true);
  assert.equal(result.request.browser_mode, false);
  assert.equal(result.request.paid_services, false);
});

test("rejects unapproved targets, oversized jobs, browser mode, and link following", () => {
  assert.equal(createSpiderJobRequest({ job_id: "x", urls: ["https://unknown.example"] }, { approvedHosts }).accepted, false);
  assert.ok(createSpiderJobRequest({ job_id: "x", urls: Array(11).fill("https://example.org") }, { approvedHosts }).errors.includes("url-limit-exceeded"));
  assert.ok(createSpiderJobRequest({ job_id: "x", urls: ["https://example.org"], browser_mode: true }, { approvedHosts }).errors.includes("browser-mode-disabled-in-initial-pilot"));
  assert.ok(createSpiderJobRequest({ job_id: "x", urls: ["https://example.org"], follow_links: true }, { approvedHosts }).errors.includes("link-following-disabled-in-initial-pilot"));
});

test("rejects invalid concurrency and timeout", () => {
  assert.ok(createSpiderJobRequest({ job_id: "x", urls: ["https://example.org"], concurrency: 3 }, { approvedHosts }).errors.includes("concurrency-out-of-range"));
  assert.ok(createSpiderJobRequest({ job_id: "x", urls: ["https://example.org"], timeout_ms: 30000 }, { approvedHosts }).errors.includes("timeout-out-of-range"));
});

test("validates Spider result provenance before accepting records", () => {
  const result = validateSpiderJobResult({
    protocol: "ceoai-spider/1",
    job_id: "pilot_001",
    adapter_id: "spider",
    records: [validRecord()],
    external_actions: false,
    paid_services: false,
  }, { approvedHosts, now: Date.parse("2026-10-30T12:01:00.000Z") });
  assert.equal(result.accepted, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].adapter_id, "spider");
  assert.equal(result.records[0].verification_status, "awaiting-independent-confirmation");
});

test("fails closed when Spider returns unsafe flags, unknown source, or malformed records", () => {
  const unsafe = validateSpiderJobResult({
    protocol: "ceoai-spider/1", job_id: "pilot_001", adapter_id: "spider",
    records: [validRecord()], external_actions: true, paid_services: false,
  }, { approvedHosts });
  assert.equal(unsafe.accepted, false);
  assert.deepEqual(unsafe.records, []);

  const badSource = validateSpiderJobResult({
    protocol: "ceoai-spider/1", job_id: "pilot_001", adapter_id: "spider",
    records: [validRecord({ source_url: "https://unknown.example/data" })],
    external_actions: false, paid_services: false,
  }, { approvedHosts });
  assert.equal(badSource.accepted, false);
  assert.equal(badSource.rejected_count, 1);
  assert.equal(badSource.records.length, 0);
});

test("rejects incompatible protocol and oversized result batches", () => {
  const result = validateSpiderJobResult({
    protocol: "ceoai-spider/2", job_id: "pilot_001", adapter_id: "spider",
    records: Array(101).fill(validRecord()),
    external_actions: false, paid_services: false,
  }, { approvedHosts });
  assert.equal(result.accepted, false);
  assert.ok(result.errors.includes("protocol-mismatch"));
  assert.ok(result.errors.includes("record-limit-exceeded"));
});
