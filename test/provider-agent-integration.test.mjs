import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../ceoai-index-v5.0.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const secret = "test-agent-gateway-secret-at-least-32-bytes-long";
const appId = "CONTENTCRAFT-APP";
const encoder = new TextEncoder();

function env(extra = {}) {
  const memory = new Map();
  return {
    AI_ENABLED: "true",
    HMAC_ALLOWED_APPS: appId,
    APP_SECRET_CONTENTCRAFT_APP: secret,
    KV_MEMORY: {
      async get(key) { return memory.get(key) ?? null; },
      async put(key, value) { memory.set(key, value); },
      async delete(key) { memory.delete(key); },
    },
    RATE_LIMITER: { async limit() { return { success: true }; } },
    SECURITY_DO: {
      idFromName(name) { return name; },
      get() { return { async fetch() { return Response.json({ success: true }); } }; },
    },
    ...extra,
  };
}

async function signedRequest(body, path = "/v1/agents/run") {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "agent_test_nonce_" + crypto.randomUUID().replaceAll("-", "");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  const bodyHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const canonical = ["POST", path, timestamp, nonce, bodyHash].join("\n");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return new Request("https://ceoai.test" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Id": appId,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": Buffer.from(signature).toString("base64"),
    },
    body: raw,
  });
}

test("agent route fails closed when AI is disabled", async () => {
  const response = await worker.fetch(await signedRequest({ task: "review" }), env({ AI_ENABLED: "false" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "AI_DISABLED");
});

test("agent route reports no configured provider without making an external call", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not call provider"); };
  try {
    const response = await worker.fetch(await signedRequest({ task: "review" }), env());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "NO_PROVIDER_CONFIGURED");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});

test("agent route refuses a keyed provider without explicit free confirmation", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unconfirmed provider must not be called"); };
  try {
    const response = await worker.fetch(
      await signedRequest({ task: "review" }),
      env({ DEEPSEEK_KEY: "test-key" })
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "NO_FREE_PROVIDER_CONFIRMED");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});

test("caller cannot enable tool execution through request JSON", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not call provider"); };
  try {
    const response = await worker.fetch(
      await signedRequest({ task: "review", allowToolExecution: true }),
      env()
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_REQUEST");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});

test("agent route does not silently expose an alternate HTTP route", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../ceoai-index-v5.0.mjs", import.meta.url), "utf8"
  );
  assert.equal(source.includes('url.pathname === "/api/agents/run"'), false);
});
