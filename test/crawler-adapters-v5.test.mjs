import test from "node:test";
import assert from "node:assert/strict";
import {
  listCrawlerAdapters,
  planCrawlerTask,
  validateCrawlerAdapterEnvelope,
} from "../src/v5-modules/crawler-adapters.mjs";

test("crawler adapters are candidates and disabled by default", () => {
  const adapters = listCrawlerAdapters();
  assert.deepEqual(adapters.map(item => item.id), ["spider", "scrapling", "scrapy"]);
  assert.ok(adapters.every(item => item.status === "candidate" && item.enabledByDefault === false));
});

test("planner fails closed when no adapter has been explicitly enabled", () => {
  const result = planCrawlerTask({ type: "simple" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "no-enabled-adapter-satisfies-task");
});

test("planner selects an enabled compatible adapter for browser tasks", () => {
  const result = planCrawlerTask(
    { type: "browser" },
    { enabledAdapters: ["scrapy", "spider"], preferredAdapter: "spider" },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.adapter, "spider");
  assert.equal(result.execution_enabled, true);
  assert.equal(result.external_actions, false);
  assert.equal(result.paid_services, false);
});

test("planner does not select incompatible adapter or unsupported task", () => {
  assert.equal(
    planCrawlerTask({ type: "browser" }, { enabledAdapters: ["scrapy"] }).accepted,
    false,
  );
  assert.equal(planCrawlerTask({ type: "unknown" }).reason, "unsupported-task-type");
});

test("adapter envelope accepts a bounded, free-only result shape", () => {
  const result = validateCrawlerAdapterEnvelope({
    schema_version: "1.0",
    adapter_id: "spider",
    job_id: "job_123",
    records: [],
    external_actions: false,
    paid_services: false,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("adapter envelope rejects unknown engines, unsafe flags, and oversized batches", () => {
  const result = validateCrawlerAdapterEnvelope({
    schema_version: "2.0",
    adapter_id: "unknown",
    job_id: "bad job id",
    records: Array(101).fill({}),
    external_actions: true,
    paid_services: true,
  });
  assert.equal(result.valid, false);
  for (const reason of [
    "unsupported-schema-version",
    "unknown-adapter-id",
    "invalid-job-id",
    "record-limit-exceeded",
    "external-actions-must-be-disabled",
    "paid-services-must-be-disabled",
  ]) assert.ok(result.errors.includes(reason), reason);
});
