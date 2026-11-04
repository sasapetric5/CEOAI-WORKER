import test from "node:test";
import assert from "node:assert/strict";
import { createBuiltinResearchAgentSystem } from "../src/agent/research-agent-system.mjs";

const response = {
  hits: [
    { objectID: "1", title: "Cloudflare Queues", url: "https://example.com/queues", author: "alice", points: 12, num_comments: 3, created_at: "2026-11-05T10:00:00Z", secret: "must-not-leak" },
  ],
  nbHits: 1,
  page: 0,
};

test("Supervisor can discover and use read-only research only when caller grants capability", async () => {
  const calls = [];
  const system = createBuiltinResearchAgentSystem({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(response);
    },
  });
  const task = "Research Hacker News discussions about Cloudflare Queues";
  const prepared = await system.multiAgentSupervisor.prepare({ task, limit: 1 });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.agents[0].id, "knowledge_retrieval_engineer");
  assert.equal(prepared.agents[0].skillId, "hacker_news_public_research");

  const denied = await system.multiAgentSupervisor.run({
    task, limit: 1, allowToolExecution: true, allowedToolIds: [],
    planAgent: async ({ context }) => {
      assert.deepEqual(context.availableToolIds, []);
      return { type: "final", output: "No research capability was granted." };
    },
  });
  assert.equal(denied.ok, true);
  assert.equal(calls.length, 0);

  let planCalls = 0;
  const allowed = await system.multiAgentSupervisor.run({
    task, limit: 1, allowToolExecution: true, allowedToolIds: ["hacker_news_search"],
    planAgent: async ({ context }) => {
      planCalls++;
      if (context.step === 1) {
        assert.deepEqual(context.availableToolIds, ["hacker_news_search"]);
        return { type: "tool", toolId: "hacker_news_search", arguments: { query: "Cloudflare Queues" } };
      }
      assert.equal(context.input.tool, "hacker_news_search");
      assert.equal(context.input.result.records[0].title, "Cloudflare Queues");
      assert.equal(JSON.stringify(context.input).includes("must-not-leak"), false);
      return { type: "final", output: "Found one relevant public discussion." };
    },
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.results[0].ok, true);
  assert.equal(allowed.budgetUsed, 1);
  assert.equal(planCalls, 2);
  assert.equal(calls.length, 1);
  const requested = new URL(calls[0].url);
  assert.equal(requested.origin, "https://hn.algolia.com");
  assert.equal(requested.pathname, "/api/v1/search");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
});

test("public app gateway composition has no research capability unless explicitly supplied", async () => {
  const calls = [];
  const system = createBuiltinResearchAgentSystem({
    fetchImpl: async () => { calls.push("unexpected"); return Response.json(response); },
  });
  const result = await system.multiAgentSupervisor.run({
    task: "Research Hacker News discussions about Cloudflare Queues",
    limit: 1,
    allowToolExecution: true,
    allowedToolIds: [],
    planAgent: async ({ context }) => {
      assert.deepEqual(context.availableToolIds, []);
      return { type: "final", output: "No tool access." };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
});
