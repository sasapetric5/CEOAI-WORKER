import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../ceoai-index-v5.0.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const secret = "test-contentcraft-app-secret-at-least-32-bytes";
const body = JSON.stringify({ model: "ceoai-auto", messages: [{ role: "user", content: "hello" }] });
const bytes = new TextEncoder().encode(body);
const appId = "CONTENTCRAFT-APP";

async function signedHeaders(nonce) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  const canonical = ["POST", "/v1/chat/completions", timestamp, nonce, hex].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return {
    "Content-Type": "application/json",
    "X-App-Id": appId,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": Buffer.from(signature).toString("base64"),
  };
}

function makeEnv() {
  const used = new Set();
  const data = new Map();
  return {
    AI_ENABLED: "true",
    EXTERNAL_AI_ENABLED: "true",
    OPENROUTER_FREE_CONFIRMED: "true",
    HMAC_ALLOWED_APPS: appId,
    APP_SECRET_CONTENTCRAFT_APP: secret,
    KV_MEMORY: {
      async get(k) { return data.get(k) ?? null; },
      async put(k, v) { data.set(k, v); },
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
