import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

function queueConsumerBlock() {
  const match = config.match(/\[\[queues\.consumers\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/);
  assert.ok(match, "Spider Queue consumer must be declared");
  return match[1];
}

test("Spider Queue producer targets the expected durable queue", () => {
  assert.match(config, /\[\[queues\.producers\]\][\s\S]*?binding\s*=\s*"SPIDER_QUEUE"[\s\S]*?queue\s*=\s*"ceoai-spider-jobs"/);
});

test("Spider Queue consumer is serialized to one-message batches and one concurrent worker", () => {
  const block = queueConsumerBlock();
  assert.match(block, /queue\s*=\s*"ceoai-spider-jobs"/);
  assert.match(block, /max_batch_size\s*=\s*1\b/);
  assert.match(block, /max_concurrency\s*=\s*1\b/);
});

test("Spider Queue retries are bounded and delayed", () => {
  const block = queueConsumerBlock();
  assert.match(block, /max_retries\s*=\s*5\b/);
  assert.match(block, /retry_delay\s*=\s*60\b/);
});

test("Spider Queue poison messages have an explicit dead-letter destination", () => {
  const block = queueConsumerBlock();
  assert.match(block, /dead_letter_queue\s*=\s*"ceoai-spider-dlq"/);
});

test("Spider Queue producer and consumer use the same queue name", () => {
  const producer = config.match(/\[\[queues\.producers\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/);
  assert.ok(producer, "Spider Queue producer must be declared");
  const consumer = queueConsumerBlock();
  const producerQueue = producer[1].match(/queue\s*=\s*"([^"]+)"/)?.[1];
  const consumerQueue = consumer.match(/queue\s*=\s*"([^"]+)"/)?.[1];
  assert.equal(producerQueue, consumerQueue);
});
