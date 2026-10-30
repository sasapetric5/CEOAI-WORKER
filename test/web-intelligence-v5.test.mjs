import test from "node:test";
import assert from "node:assert/strict";
import {
  parseApprovedSourceHosts,
  validateCrawlTarget,
  validateCrawlRecord,
  deduplicateCrawlRecords,
} from "../src/v5-modules/web-intelligence.mjs";

const approvedHosts = ["example.org", "data.gov.rs"];
const validRecord = (overrides = {}) => ({
  source_url: "https://example.org/reports/latest#section",
  collected_at: "2026-10-30T12:00:00.000Z",
  http_status: 200,
  robots_allowed: true,
  extractor: "spider-local/2.x",
  content_hash: "a".repeat(64),
  evidence: ["Visible text excerpt from the fetched page."],
  data: { title: "Example report", value: 42 },
  ...overrides,
});

test("approved source list is normalized, unique, and rejects malformed hosts", () => {
  assert.deepEqual(
    parseApprovedSourceHosts("Example.org, example.org, localhost, 127.0.0.1, data.gov.rs"),
    ["data.gov.rs", "example.org"],
  );
});

test("crawl target requires exact approved public DNS host and HTTP(S)", () => {
  const result = validateCrawlTarget("https://example.org/path#part", approvedHosts);
  assert.equal(result.allowed, true);
  assert.equal(result.canonical_url, "https://example.org/path");
  assert.equal(validateCrawlTarget("https://sub.example.org/", approvedHosts).reason, "source-host-not-approved");
  assert.equal(validateCrawlTarget("file:///etc/passwd", approvedHosts).reason, "scheme-not-allowed");
});

test("crawl target rejects credentials, private names, IP literals, and unusual ports", () => {
  for (const url of [
    "https://user:pass@example.org/",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://192.168.1.1/",
    "http://metadata.google.internal/",
    "https://example.org:8443/",
  ]) {
    assert.equal(validateCrawlTarget(url, [...approvedHosts, "metadata.google.internal"]).allowed, false, url);
  }
});

test("valid crawl record retains provenance and stays fact-unverified", () => {
  const result = validateCrawlRecord(validRecord(), {
    approvedHosts,
    now: Date.parse("2026-10-30T12:01:00.000Z"),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.record.source_host, "example.org");
  assert.equal(result.record.source_status, "approved-source");
  assert.equal(result.record.verification_status, "awaiting-independent-confirmation");
  assert.equal(result.record.external_actions, false);
  assert.equal(result.record.paid_services, false);
});

test("record fails closed for unapproved source, non-2xx status, or unconfirmed robots permission", () => {
  assert.ok(validateCrawlRecord(validRecord({ source_url: "https://unknown.example/" }), { approvedHosts }).reasons.includes("source-host-not-approved"));
  assert.ok(validateCrawlRecord(validRecord({ http_status: 429 }), { approvedHosts }).reasons.includes("http-status-not-successful"));
  assert.ok(validateCrawlRecord(validRecord({ robots_allowed: false }), { approvedHosts }).reasons.includes("robots-permission-not-confirmed"));
});

test("record requires valid timestamp, SHA-256, extractor, data, and evidence", () => {
  const result = validateCrawlRecord(validRecord({
    collected_at: "not-a-date",
    content_hash: "bad",
    extractor: " ",
    data: [],
    evidence: [],
  }), { approvedHosts });
  assert.equal(result.accepted, false);
  assert.equal(result.record, null);
  for (const reason of [
    "collection-timestamp-invalid",
    "content-hash-must-be-sha256",
    "extractor-required",
    "extracted-data-must-be-object",
    "evidence-required",
  ]) assert.ok(result.reasons.includes(reason), reason);
});

test("record rejects timestamps too far in the future", () => {
  const result = validateCrawlRecord(validRecord({ collected_at: "2026-10-30T13:00:00.000Z" }), {
    approvedHosts,
    now: Date.parse("2026-10-30T12:00:00.000Z"),
  });
  assert.ok(result.reasons.includes("collection-timestamp-in-future"));
});

test("deduplication removes repeated URL plus content hash without dropping distinct revisions", () => {
  const records = [
    { source_url: "https://example.org/a", content_hash: "ABC" },
    { source_url: "https://example.org/a", content_hash: "abc" },
    { source_url: "https://example.org/a", content_hash: "def" },
    { source_url: "https://example.org/b", content_hash: "abc" },
    null,
  ];
  assert.equal(deduplicateCrawlRecords(records).length, 3);
});
