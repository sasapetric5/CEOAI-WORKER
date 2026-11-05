import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../ceoai-index-v5.0.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const secret = "test-contentcraft-app-secret-at-least-32-bytes";
const body = JSON.stringify({ model: "ceoai-auto", messages: [{ role: "user", content: "hello" }] });
const bytes = new TextEncoder().encode(body);
const appId = "CONTENTCRAFT-APP";

async function signedHeaders(nonce, payload = bytes, signedAppId = appId) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hash = await crypto.subtle.digest("SHA-256", payload);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  const canonical = ["POST", "/v1/chat/completions", timestamp, nonce, hex].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
  const rateLimitKeys = [];
  return {
    AI_ENABLED: "true",
    EXTERNAL_AI_ENABLED: "true",
    OPENROUTER_FREE_CONFIRMED: "true",
    HMAC_ALLOWED_APPS: appId,
    APP_SECRET_CONTENTCRAFT_APP: secret,
    KV_MEMORY: {
      async get(k) { return data.get(k) ?? null; },
      async put(k, v) { writes.push(k); data.set(k, v); },
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


test("AI Force is denied Spider access before rate limiting or queue submission", async () => {
  const env = makeEnv();
  env.HMAC_ALLOWED_APPS = "CONTENTCRAFT-APP,AIFORCE-APP";
  env.APP_SECRET_AIFORCE_APP = secret;
  let rateLimitCalls = 0;
  let queueCalls = 0;
  env.RATE_LIMITER = { async limit() { rateLimitCalls++; return { success: true }; } };
  env.SPIDER_BROWSER_RUN_ACCOUNT_ID = "test-account";
  env.SPIDER_BROWSER_RUN_TOKEN = "test-token";
  env.SPIDER_QUEUE = { async send() { queueCalls++; } };

  const payload = JSON.stringify({
    url: "https://example.com",
    pageLimit: 1,
    depth: 1,
    requestId: "123e4567-e89b-42d3-a456-426614174000"
  });
  const signedPayload = new TextEncoder().encode(payload);
  const headers = await signedHeaders("nonce_aiforce_spider_denied_123", signedPayload, "AIFORCE-APP");
  const response = await worker.fetch(new Request("https://ceoai.dev/v1/spider/crawl", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: payload
  }), env);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "CAPABILITY_NOT_GRANTED");
  assert.equal(rateLimitCalls, 0);
  assert.equal(queueCalls, 0);
});
