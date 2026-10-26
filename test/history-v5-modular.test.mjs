import test from "node:test";
import assert from "node:assert/strict";
import { MAX_HISTORY_MESSAGES, prepareConversation, appendReply, withSummary, trimHistory } from "../src/v5-modules/history.mjs";

const turns = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i}` }));

test("modular history: 16 stored messages plus new user message remains bounded", async () => {
  const result = await prepareConversation({ stored: turns(16), userMessage: "new turn" });
  assert.ok(result.messages.length <= MAX_HISTORY_MESSAGES);
  assert.equal(result.messages.at(-1).content, "new turn");
  assert.equal(result.messages[0].role, "user");
});

test("modular history sanitizes invalid roles and content", () => {
  assert.deepEqual(trimHistory([{ role: "system", content: "x" }, { role: "user", content: "ok" }, null]), [{ role: "user", content: "ok" }]);
});

test("compression failure falls back to bounded history", async () => {
  const result = await prepareConversation({ stored: turns(8), userMessage: "new", compress: async () => { throw new Error("offline"); } });
  assert.equal(result.compressionFailed, true);
  assert.equal(result.compressed, false);
  assert.equal(result.messages.at(-1).content, "new");
  assert.ok(result.messages.length <= MAX_HISTORY_MESSAGES);
});

test("successful compression retains summary and current user turn", async () => {
  const result = await prepareConversation({ stored: turns(8), userMessage: "new", compress: async () => "summary" });
  assert.equal(result.compressed, true);
  assert.equal(result.summary, "summary");
  assert.deepEqual(result.messages, [{ role: "user", content: "new" }]);
  assert.equal(appendReply(result.messages, "reply").at(-1).role, "assistant");
  assert.match(withSummary(result.messages, result.summary, "system")[1].content, /nepouzdan podatak/);
});
