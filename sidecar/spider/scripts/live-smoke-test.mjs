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
assert.ok(Array.isArray(response.records));
assert.ok(response.records.length > 0, `no page records returned: ${JSON.stringify(response.errors)}`);

const page = response.records[0];
assert.equal(new URL(page.source_url).hostname, "example.org");
assert.equal(page.http_status, 200);
assert.equal(page.robots_allowed, true);
assert.match(page.content_hash, /^[a-f0-9]{64}$/);
assert.equal(page.extractor, "spider-rs/2.53.9");
assert.ok(typeof page.data?.html === "string" && page.data.html.length > 0);

console.log(JSON.stringify({
  status: "PASS",
  mode: "live-public-source-smoke-test",
  host: "example.org",
  http_status: page.http_status,
  records: response.records.length,
  content_hash: page.content_hash,
  paid_services: false,
  external_actions: false,
}, null, 2));
