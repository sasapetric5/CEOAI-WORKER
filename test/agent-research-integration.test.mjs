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
