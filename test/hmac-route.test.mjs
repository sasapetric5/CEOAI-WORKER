import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../ceoai-index-v5.0.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const secret = "test-contentcraft-app-secret-at-least-32-bytes";
const body = JSON.stringify({ model: "ceoai-auto", messages: [{ role: "user", content: "hello" }] });
const bytes = new TextEncoder().encode(body);
const appId = "CONTENTCRAFT-APP";

async function signedHeaders(nonce, payload = bytes, signedAppId = appId, pathname = "/v1/chat/completions", signingSecret = secret) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hash = await crypto.subtle.digest("SHA-256", payload);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  const canonical = ["POST", pathname, timestamp, nonce, hex].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return {
    "Content-Type": "application/json",
    "X-App-Id": signedAppId,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": Buffer.from(signature).toString("base64"),
  };
}

function makeEnv() {
  const used = new Set();
  const data = new Map();
  const writes = [];
  const reads = [];
  const rateLimitKeys = [];
  return {
    AI_ENABLED: "true",
    EXTERNAL_AI_ENABLED: "true",
    OPENROUTER_FREE_CONFIRMED: "true",
    HMAC_ALLOWED_APPS: appId,
    APP_SECRET_CONTENTCRAFT_APP: secret,
    KV_MEMORY: {
      async get(k) { reads.push(k); return data.get(k) ?? null; },
      async put(k, v) { writes.push(k); data.set(k, v); },
      async delete(k) { data.delete(k); },
    },
    SECURITY_DO: {
      idFromName(name) { return name; },
      get() {
        return { async fetch(_url, init) {
          const { appId: id, nonce } = JSON.parse(init.body);
          const key = id + ":" + nonce;
          if (used.has(key)) return Response.json({ error: "replay" }, { status: 409 });
          used.add(key);
          return Response.json({ success: true });
        }};
      },
    },
    OPENROUTER_KEY: "test-provider-key",
    RATE_LIMITER: { async limit(input) { rateLimitKeys.push(input.key); return { success: true }; } },
    __memoryWrites: writes,
    __memoryReads: reads,
    __rateLimitKeys: rateLimitKeys,
  };
}

test("Worker gateway accepts HMAC app identity without Bearer gateway secret", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "HMAC gateway OK" } }] });
  try {
    const headers = await signedHeaders("nonce_route_success_123456");
    const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers, body,
    }), makeEnv());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, "HMAC gateway OK");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker gateway rejects replayed HMAC nonce before provider call", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return Response.json({ choices: [{ message: { content: "should not run" } }] });
  };
  try {
    const env = makeEnv();
    const headers = await signedHeaders("nonce_route_replay_123456");
    const makeRequest = () => new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers, body,
    });
    const first = await worker.fetch(makeRequest(), env);
    assert.equal(first.status, 200);
    const second = await worker.fetch(makeRequest(), env);
    assert.equal(second.status, 401);
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HMAC chat gateway rejects oversized bodies before buffering or provider calls", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return Response.json({ choices: [{ message: { content: "should not run" } }] });
  };
  try {
    const oversized = "x".repeat(16001);
    const payload = new TextEncoder().encode(oversized);
    const headers = await signedHeaders("nonce_chat_oversized_123456", payload);
    const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST",
      headers,
      body: oversized,
    }), makeEnv());
    assert.equal(response.status, 413);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("HMAC app chat remains stateless and never writes browser UI session memory", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "stateless app reply" } }] });
  try {
    const env = makeEnv();
    const headers = await signedHeaders("nonce_stateless_app_123456");
    const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers, body,
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(env.__memoryWrites.filter(key => key.startsWith("memory:") || key.startsWith("session:")), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("HMAC app identity comes from the signed header, never a client JSON appId", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "identity remains signed" } }] });
  try {
    const env = makeEnv();
    const forgedBody = JSON.stringify({
      model: "ceoai-auto",
      appId: "AI_FORCE",
      messages: [{ role: "user", content: "hello" }],
    });
    const payload = new TextEncoder().encode(forgedBody);
    const headers = await signedHeaders("nonce_body_appid_spoof_12345", payload);
    const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers, body: forgedBody,
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(env.__rateLimitKeys, ["gateway:CONTENTCRAFT-APP"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("AI Force can enqueue Spider jobs under its explicit app-scoped grant", async () => {
  const env = makeEnv();
  env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,AIFORCE-APP";
  env.APP_SECRET_AIFORCE_APP = secret;
  let rateLimitCalls = 0;
  const queued = [];
  env.RATE_LIMITER = { async limit(input) { rateLimitCalls++; assert.equal(input.key, "spider:AIFORCE-APP"); return { success: true }; } };
  env.SPIDER_BROWSER_RUN_ACCOUNT_ID = "test-account";
  env.SPIDER_BROWSER_RUN_TOKEN = "test-token";
  env.SPIDER_QUEUE = { async send(message) { queued.push(message); } };

  const payload = JSON.stringify({
    url: "https://example.com",
    pageLimit: 1,
    depth: 1,
    requestId: "123e4567-e89b-42d3-a456-426614174000"
  });
  const signedPayload = new TextEncoder().encode(payload);
  const headers = await signedHeaders("nonce_aiforce_spider_granted_123", signedPayload, "AIFORCE-APP", "/v1/spider/crawl");
  const response = await worker.fetch(new Request("https://ceoai.dev/v1/spider/crawl", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: payload
  }), env);

  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, "queued");
  assert.equal(rateLimitCalls, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].appId, "AIFORCE-APP");
  assert.equal(queued[0].id, "123e4567-e89b-42d3-a456-426614174000");
});

test("ContentCraft and AI Force have independent HMAC identities and no shared conversation memory", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "stateless isolated reply" } }] });
  try {
    const env = makeEnv();
    env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,AIFORCE-APP";
    env.APP_SECRET_AIFORCE_APP = secret;
    const calls = [
      { appId: "CONTENTCRAFT-APP", nonce: "nonce_memory_contentcraft_123" },
      { appId: "AIFORCE-APP", nonce: "nonce_memory_aiforce_123456" }
    ];
    for (const call of calls) {
      const headers = await signedHeaders(call.nonce, bytes, call.appId);
      const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
        method: "POST", headers, body
      }), env);
      assert.equal(response.status, 200, call.appId);
    }
    assert.deepEqual(env.__rateLimitKeys, ["gateway:CONTENTCRAFT-APP", "gateway:AIFORCE-APP"]);
    assert.equal(env.__memoryReads.some(key => key.startsWith("memory:") || key.startsWith("session:")), false);
    assert.equal(env.__memoryWrites.some(key => key.startsWith("memory:") || key.startsWith("session:")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("three application HMAC secrets are independent and cannot impersonate one another", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return Response.json({ choices: [{ message: { content: "identity verified" } }] });
  };
  try {
    const env = makeEnv();
    const aiSecret = "aiforce-separate-test-secret-at-least-32-bytes";
    const rankSecret = "rankgeo-separate-test-secret-at-least-32-bytes";
    env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,AIFORCE-APP,RANKGEO-APP";
    env.APP_SECRET_AIFORCE_APP = aiSecret;
    env.APP_SECRET_RANKGEO_APP = rankSecret;
    const payload = new TextEncoder().encode(body);
    const validCases = [
      ["CONTENTCRAFT-APP", secret, "nonce_hmac_cc_identity_123456"],
      ["AIFORCE-APP", aiSecret, "nonce_hmac_ai_identity_123456"],
      ["RANKGEO-APP", rankSecret, "nonce_hmac_rg_identity_123456"],
    ];
    for (const [id, signingSecret, nonce] of validCases) {
      const headers = await signedHeaders(nonce, payload, id, "/v1/chat/completions", signingSecret);
      const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
        method: "POST", headers, body
      }), env);
      assert.equal(response.status, 200, id + " should authenticate with its own key");
    }
    const forgedHeaders = await signedHeaders(
      "nonce_hmac_rg_forged_123456",
      payload,
      "RANKGEO-APP",
      "/v1/chat/completions",
      secret
    );
    const forged = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers: forgedHeaders, body
    }), env);
    assert.equal(forged.status, 401);
    assert.equal(providerCalls, 3);
    assert.deepEqual(env.__rateLimitKeys, [
      "gateway:CONTENTCRAFT-APP", "gateway:AIFORCE-APP", "gateway:RANKGEO-APP"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RankGeo has an independent HMAC identity and enabled chat memory", async () => {
  const originalFetch = globalThis.fetch;
  const rankGeoSecret = "rankgeo-independent-secret-at-least-32-bytes";
  const providerPayloads = [];
  globalThis.fetch = async (_url, options) => {
    providerPayloads.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: "rankgeo private reply" } }] });
  };
  try {
    const env = makeEnv();
    env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,RANKGEO-APP";
    env.APP_SECRET_RANKGEO_APP = rankGeoSecret;
    const conversationId = "123e4567-e89b-42d3-a456-426614174002";
    const payload = JSON.stringify({
      model: "ceoai-auto",
      conversation_id: conversationId,
      messages: [{ role: "user", content: "rankgeo private context" }],
    });
    const headers = await signedHeaders(
      "nonce_rankgeo_chat_enabled_12345",
      new TextEncoder().encode(payload),
      "RANKGEO-APP",
      "/v1/chat/completions",
      rankGeoSecret
    );
    const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers, body: payload,
    }), env);
    assert.equal(response.status, 200);
    assert.equal(providerPayloads.length, 1);
    assert.deepEqual(env.__rateLimitKeys, ["gateway:RANKGEO-APP"]);
    assert.equal(env.__memoryWrites.some(key => key.startsWith("app-memory:v1:RANKGEO-APP:")), true);
    assert.equal(env.__memoryWrites.some(key => key.startsWith("app-memory:v1:CONTENTCRAFT-APP:")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RankGeo has its own Spider grant and per-app quota key", async () => {
  const rankGeoSecret = "rankgeo-independent-secret-at-least-32-bytes";
  const env = makeEnv();
  env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,RANKGEO-APP";
  env.APP_SECRET_RANKGEO_APP = rankGeoSecret;
  const queued = [];
  const rateLimitKeys = [];
  env.RATE_LIMITER = { async limit(input) { rateLimitKeys.push(input.key); return { success: true }; } };
  env.SPIDER_BROWSER_RUN_ACCOUNT_ID = "test-account";
  env.SPIDER_BROWSER_RUN_TOKEN = "test-token";
  env.SPIDER_QUEUE = { async send(message) { queued.push(message); } };
  const payload = JSON.stringify({
    url: "https://example.com",
    pageLimit: 1,
    depth: 1,
    requestId: "123e4567-e89b-42d3-a456-426614174003"
  });
  const headers = await signedHeaders(
    "nonce_rankgeo_spider_enabled_1234",
    new TextEncoder().encode(payload),
    "RANKGEO-APP",
    "/v1/spider/crawl",
    rankGeoSecret
  );
  const response = await worker.fetch(new Request("https://ceoai.dev/v1/spider/crawl", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: payload
  }), env);
  assert.equal(response.status, 202);
  assert.deepEqual(rateLimitKeys, ["spider:RANKGEO-APP"]);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].appId, "RANKGEO-APP");
  assert.equal(queued[0].id, "123e4567-e89b-42d3-a456-426614174003");
});

test("HMAC chat persists and reloads only its own app conversation when conversation_id is supplied", async () => {
  const originalFetch = globalThis.fetch;
  const providerPayloads = [];
  globalThis.fetch = async (_url, options) => {
    providerPayloads.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: "remembered reply " + providerPayloads.length } }] });
  };
  try {
    const env = makeEnv();
    const conversationId = "123e4567-e89b-42d3-a456-426614174000";
    const send = async (nonce, message) => {
      const payload = JSON.stringify({
        model: "ceoai-auto",
        conversation_id: conversationId,
        messages: [{ role: "user", content: message }],
      });
      const headers = await signedHeaders(nonce, new TextEncoder().encode(payload));
      return worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
        method: "POST", headers, body: payload,
      }), env);
    };
    assert.equal((await send("nonce_app_memory_first_123456", "first private message")).status, 200);
    assert.equal((await send("nonce_app_memory_second_12345", "second private message")).status, 200);
    assert.deepEqual(providerPayloads[0].messages.map(m => m.content), ["first private message"]);
    assert.deepEqual(providerPayloads[1].messages.map(m => m.content), [
      "first private message", "remembered reply 1", "second private message",
    ]);
    assert.equal(env.__memoryWrites.some(key => key.startsWith("app-memory:v1:CONTENTCRAFT-APP:")), true);
    assert.equal(env.__memoryWrites.some(key => key.startsWith("memory:") || key.startsWith("session:")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("same conversation UUID is isolated between ContentCraft and AI Force", async () => {
  const originalFetch = globalThis.fetch;
  const providerPayloads = [];
  globalThis.fetch = async (_url, options) => {
    providerPayloads.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: "reply" } }] });
  };
  try {
    const env = makeEnv();
    env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,AIFORCE-APP";
    env.APP_SECRET_AIFORCE_APP = secret;
    const conversationId = "123e4567-e89b-42d3-a456-426614174001";
    for (const [app, nonce, message] of [
      ["CONTENTCRAFT-APP", "nonce_cc_isolation_123456789", "cc-only"],
      ["AIFORCE-APP", "nonce_af_isolation_123456789", "af-only"],
    ]) {
      const payload = JSON.stringify({ model: "ceoai-auto", conversation_id: conversationId, messages: [{ role: "user", content: message }] });
      const headers = await signedHeaders(nonce, new TextEncoder().encode(payload), app);
      const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", { method: "POST", headers, body: payload }), env);
      assert.equal(response.status, 200);
    }
    assert.deepEqual(providerPayloads[0].messages.map(m => m.content), ["cc-only"]);
    assert.deepEqual(providerPayloads[1].messages.map(m => m.content), ["af-only"]);
    assert.equal(env.__memoryWrites.some(key => key.startsWith("app-memory:v1:CONTENTCRAFT-APP:")), true);
    assert.equal(env.__memoryWrites.some(key => key.startsWith("app-memory:v1:AIFORCE-APP:")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HMAC chat rejects malformed conversation_id before provider or memory access", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error("unexpected provider call"); };
  try {
    const env = makeEnv();
    const payload = JSON.stringify({ model: "ceoai-auto", conversation_id: "../other-app", messages: [{ role: "user", content: "hello" }] });
    const headers = await signedHeaders("nonce_invalid_conversation_id_123", new TextEncoder().encode(payload));
    const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", { method: "POST", headers, body: payload }), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_conversation_id");
    assert.equal(providerCalls, 0);
    assert.equal(env.__memoryWrites.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Spider result endpoint enforces signed app identity and hides foreign results", async () => {
  const env = makeEnv();
  const jobId = "123e4567-e89b-42d3-a456-426614174021";
  const ownerApp = "CONTENTCRAFT-APP";
  const resultKey = "spider:result:" + ownerApp + ":" + jobId;
  const resultDocument = { appId: ownerApp, jobId, records: [{ url: "https://docs.example.com/" }] };
  env.KV_MEMORY.get = async key => key === resultKey ? JSON.stringify(resultDocument) : null;
  env.SPIDER_LEDGER = {
    idFromName(name) { return name; },
    get(name) {
      return { async fetch(_url, init) {
        const input = JSON.parse(init.body);
        const scopedApp = name.split(":")[1];
        if (input.appId !== scopedApp || scopedApp !== ownerApp || input.id !== jobId) {
          return Response.json({ ok: true, state: null });
        }
        return Response.json({ ok: true, state: {
          appId: ownerApp, id: jobId, status: "completed", resultKey
        }});
      }};
    }
  };
  env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,AIFORCE-APP";
  env.APP_SECRET_AIFORCE_APP = secret;

  const payload = JSON.stringify({ jobId });
  const signed = new TextEncoder().encode(payload);
  const ownerHeaders = await signedHeaders("nonce_spider_result_owner_1234", signed, ownerApp, "/v1/spider/result");
  const ownerResponse = await worker.fetch(new Request("https://ceoai.dev/v1/spider/result", {
    method: "POST", headers: ownerHeaders, body: payload
  }), env);
  assert.equal(ownerResponse.status, 200);
  assert.equal((await ownerResponse.json()).result.appId, ownerApp);

  const foreignHeaders = await signedHeaders("nonce_spider_result_foreign_123", signed, "AIFORCE-APP", "/v1/spider/result");
  const foreignResponse = await worker.fetch(new Request("https://ceoai.dev/v1/spider/result", {
    method: "POST", headers: foreignHeaders, body: payload
  }), env);
  assert.equal(foreignResponse.status, 404);
  assert.equal((await foreignResponse.json()).code, "SPIDER_JOB_NOT_FOUND");
  assert.deepEqual(env.__rateLimitKeys, ["spider-results:CONTENTCRAFT-APP", "spider-results:AIFORCE-APP"]);
});

