import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../ceoai-index-v5.0.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const secret = "test-contentcraft-agent-secret-at-least-32-bytes";
const encoder = new TextEncoder();

function environment(extra = {}) {
  const seen = new Set();
  const memory = new Map();
  return {
    AI_ENABLED: "true",
    OPENROUTER_FREE_CONFIRMED: "true",
    OPENROUTER_KEY: "test-openrouter-key",
    HMAC_ALLOWED_APPS: "CONTENTCRAFT-APP,AIFORCE-APP",
    APP_SECRET_CONTENTCRAFT_APP: secret,
    KV_MEMORY: {
      async get(key) { return memory.get(key) ?? null; },
      async put(key, value) { memory.set(key, value); },
    },
    RATE_LIMITER: { async limit() { return { success: true }; } },
    WORKFLOW_TASKS: {
      idFromName(name) { return name; },
      get() { return { async fetch(url, options) {
        const body = JSON.parse(options.body);
        if (new URL(url).pathname !== "/skill/get") return Response.json({ok:false,code:"NOT_FOUND"},{status:404});
        return Response.json({ok:true,record:{
          schemaVersion:1,revision:1,id:body.skillId,status:"ACTIVE",costStatus:"free",ownerApproved:true,
          securityReview:{sourcePinned:true,licenseVerified:true,hashVerified:true,dependenciesReviewed:true,scriptsReviewed:true,networkReviewed:true,credentialsReviewed:true},
          quality:{runs:1,passes:1,failures:0,consecutiveFailures:0,lastResult:{passed:1,total:1,score:1}}
        }});
      }}; }
    },
    SECURITY_DO: {
      idFromName(name) { return name; },
      get() {
        return {
          async fetch(_url, options) {
            const { appId, nonce } = JSON.parse(options.body);
            const key = appId + ":" + nonce;
            if (seen.has(key)) return Response.json({ error: "replay" }, { status: 409 });
            seen.add(key);
            return Response.json({ success: true });
          },
        };
      },
    },
    DUCKDUCKGO_ENABLED: "false",
    ...extra,
  };
}

async function signedRequest(body) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "research_nonce_" + crypto.randomUUID().replaceAll("-", "");
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const canonical = ["POST", "/v1/agents/run", timestamp, nonce, hex].join("\n");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return new Request("https://ceoai.test/v1/agents/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Id": "CONTENTCRAFT-APP",
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": Buffer.from(signature).toString("base64"),
    },
    body: raw,
  });
}

test("ContentCraft agent gateway reuses configured web search and marks results as untrusted context", async () => {
  const originalFetch = globalThis.fetch;
  let searchCalls = 0;
  let modelCalls = 0;
  let sawResearch = false;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith("https://api.duckduckgo.com/")) {
      searchCalls++;
      return Response.json({
        AbstractText: "Queue documentation excerpt.", AbstractURL: "https://developers.cloudflare.com/queues/", RelatedTopics: [],
      });
    }
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      modelCalls++;
      const body = JSON.parse(options.body);
      const synthesis = body.messages[0].content.includes("završni koordinator");
      if (!synthesis) {
        const plan = JSON.parse(body.messages[1].content);
        const context = plan.context?.input?.researchContext ?? plan.originalInput?.researchContext;
        sawResearch = context?.source === "duckduckgo" &&
          context?.trust === "untrusted_reference" &&
          context?.content?.includes("Queue documentation excerpt.") === true;
      }
      const content = synthesis
        ? JSON.stringify({ output: "Analiza je zasnovana na pronađenom izvoru." })
        : JSON.stringify({ type: "final", output: "Pregledao sam dostavljeni istraživački kontekst." });
      return Response.json({ choices: [{ message: { content } }] });
    }
    throw new Error("Unexpected network destination");
  };
  try {
    const env = environment({ DUCKDUCKGO_ENABLED: "true" });
    const response = await worker.fetch(await signedRequest({
      task: "Pretraži web i istraži Cloudflare Queues obrasce.",
      input: { appFeature: "ContentCraft research" },
      limit: 1,
    }), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.researchUsed, true);
    assert.equal(data.researchSource, "duckduckgo");
    assert.equal(searchCalls, 1);
    assert.equal(modelCalls, 2);
    assert.equal(sawResearch, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent gateway continues safely when no search provider returns results", async () => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      modelCalls++;
      const body = JSON.parse(options.body);
      const synthesis = body.messages[0].content.includes("završni koordinator");
      const content = synthesis
        ? JSON.stringify({ output: "Nije dostupan svež rezultat pretrage." })
        : JSON.stringify({ type: "final", output: "Nije dostupan svež rezultat pretrage." });
      return Response.json({ choices: [{ message: { content } }] });
    }
    throw new Error("Search provider should not be called when disabled");
  };
  try {
    const response = await worker.fetch(await signedRequest({
      task: "Pretraži web i istraži Cloudflare Queues.",
      input: {},
      limit: 1,
    }), environment());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.researchUsed, false);
    assert.equal(data.researchSource, null);
    assert.equal(modelCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("agent gateway falls back to free discovery when Jina cannot read a supplied URL", async () => {
  const originalFetch = globalThis.fetch;
  let searchCalls = 0;
  let sawResearch = false;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith("https://r.jina.ai/")) throw new Error("Jina temporarily unavailable");
    if (target.startsWith("https://api.duckduckgo.com/")) {
      searchCalls++;
      return Response.json({
        AbstractText: "Fallback research excerpt.", AbstractURL: "https://docs.example.com/", RelatedTopics: [],
      });
    }
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(options.body);
      const synthesis = body.messages[0].content.includes("završni koordinator");
      if (!synthesis) {
        const plan = JSON.parse(body.messages[1].content);
        const context = plan.context?.input?.researchContext ?? plan.originalInput?.researchContext;
        sawResearch = context?.source === "duckduckgo" &&
          context?.trust === "untrusted_reference" &&
          context?.content?.includes("Fallback research excerpt.") === true;
      }
      const content = synthesis
        ? JSON.stringify({ output: "Fallback izvor je iskorišćen." })
        : JSON.stringify({ type: "final", output: "Istraživanje je nastavljeno drugim besplatnim izvorom." });
      return Response.json({ choices: [{ message: { content } }] });
    }
    throw new Error("Unexpected network destination");
  };
  try {
    const response = await worker.fetch(await signedRequest({
      task: "Pretraži web i istraži Cloudflare dokumentaciju: https://docs.example.com/guide",
      input: {},
      limit: 1,
    }), environment({ DUCKDUCKGO_ENABLED: "true" }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.researchUsed, true);
    assert.equal(data.researchSource, "duckduckgo");
    assert.equal(searchCalls, 1);
    assert.equal(sawResearch, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent gateway routes an explicitly requested crawl to Spider only when operator-enabled", async () => {
  const originalFetch = globalThis.fetch;
  const queued = [];
  let sawQueuedSpiderContext = false;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("Unexpected data provider");
    const body = JSON.parse(options.body);
    const synthesis = body.messages[0].content.includes("završni koordinator");
    if (!synthesis) {
      const plan = JSON.parse(body.messages[1].content);
      const context = plan.context?.input?.crawlerContext ?? plan.originalInput?.crawlerContext;
      sawQueuedSpiderContext = context?.provider === "spider_browser_run" &&
        context?.status === "queued" && context?.trust === "untrusted_reference";
    }
    return Response.json({ choices: [{ message: { content: synthesis
      ? JSON.stringify({ output: "Spider crawl je stavljen u red." })
      : JSON.stringify({ type: "final", output: "Spider crawl je stavljen u red." }) } }] });
  };
  try {
    const response = await worker.fetch(await signedRequest({
      task: "Crawl https://docs.example.com/guide across all pages and research Cloudflare Queues.",
      input: {},
      limit: 1,
    }), environment({
      SPIDER_AGENT_ROUTING_ENABLED: "true",
      SPIDER_BROWSER_RUN_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      SPIDER_BROWSER_RUN_TOKEN: "test-spider-token",
      SPIDER_QUEUE: { async send(message) { queued.push(message); } },
    }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.routing.modelIntent, "research");
    assert.deepEqual(data.routing.modelProviders, ["openrouter-1"]);
    assert.deepEqual(data.routing.dataProviders, ["spider_browser_run"]);
    assert.equal(data.routing.spiderJob.status, "queued");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, "start");
    assert.equal(queued[0].url, "https://docs.example.com/guide");
    assert.equal(sawQueuedSpiderContext, true);
    assert.equal(data.researchUsed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
