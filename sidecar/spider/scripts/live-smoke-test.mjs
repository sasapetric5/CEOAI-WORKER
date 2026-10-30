import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const request = {
  protocol: "ceoai-spider/1",
  job_id: "github_live_smoke_001",
  adapter_id: "spider",
  urls: ["https://example.org/"],
  concurrency: 1,
  timeout_ms: 10000,
  browser_mode: false,
  follow_links: false,
  obey_robots_txt: true,
  respect_retry_after: true,
  max_records: 5,
  external_actions: false,
  paid_services: false,
};

const startedAt = process.hrtime.bigint();
const result = spawnSync(
  "cargo",
  ["run", "--quiet", "--manifest-path", "sidecar/spider/Cargo.toml"],
  {
    input: JSON.stringify(request) + "\n",
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      CEOAI_CRAWLER_APPROVED_HOSTS: "example.org",
    },
  },
);

if (result.error) throw result.error;
assert.equal(result.status, 0, `sidecar process failed: ${result.stderr}`);

const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
const lines = result.stdout.trim().split(/\r?\n/);
assert.equal(lines.length, 1, "sidecar must return exactly one JSONL response");
const response = JSON.parse(lines[0]);

assert.equal(response.protocol, "ceoai-spider/1");
assert.equal(response.job_id, request.job_id);
assert.equal(response.adapter_id, "spider");
assert.equal(response.external_actions, false);
assert.equal(response.paid_services, false);
assert.equal(response.execution?.mode, "local-http-only-serial-pilot");
assert.equal(response.execution?.robots_txt, true);
assert.equal(response.execution?.robots_decision_visibility, "not-exposed-by-spider-adapter");
assert.equal(response.execution?.retry_after, "not-implemented");
assert.ok(Array.isArray(response.records));
assert.ok(response.records.length > 0, `no page records returned: ${JSON.stringify(response.errors)}`);

const page = response.records[0];
assert.equal(new URL(page.source_url).hostname, "example.org");
assert.equal(page.http_status, 200);
assert.equal(page.robots_allowed, null, "adapter must not claim a per-page robots decision it cannot expose");
assert.match(page.robots_enforcement, /respect-robots-txt-enabled/);
assert.equal(page.retry_after_respected, false, "Retry-After is not implemented yet");
assert.match(page.content_hash, /^[a-f0-9]{64}$/);
assert.equal(page.extractor, "spider-rs/2.53.9");
assert.ok(typeof page.data?.html === "string" && page.data.html.length > 0);
assert.equal(typeof page.data?.truncation?.spider_transport_content_truncated, "boolean");
assert.equal(typeof page.data?.truncation?.output_html_truncated, "boolean");
assert.equal(typeof page.data?.truncation?.content_truncated, "boolean");
assert.equal(page.data?.truncation?.content_limit_scope, "output-serialization-only; not a transport byte cap");
assert.ok(page.data?.truncation?.spider_bytes_transferred === null || typeof page.data?.truncation?.spider_bytes_transferred === "number");
assert.ok(typeof page.data?.extracted?.title === "string" && page.data.extracted.title.length > 0);
assert.ok(typeof page.data?.extracted?.text === "string" && page.data.extracted.text.length > 0);
assert.equal(page.data.extracted.extraction_method, "scraper-html-selectors");
assert.equal(page.data.extracted.extraction_version, "1");
assert.ok(Array.isArray(page.data.extracted.headings));
assert.ok(Array.isArray(page.data.extracted.links));

console.log(JSON.stringify({
  status: "PASS",
  mode: "live-public-source-smoke-test",
  host: "example.org",
  http_status: page.http_status,
  records: response.records.length,
  sidecar_end_to_end_ms: Math.round(elapsedMs),
  timing_note: "Includes process startup; not pure network latency",
  content_hash: page.content_hash,
  paid_services: false,
  external_actions: false,
}, null, 2));
