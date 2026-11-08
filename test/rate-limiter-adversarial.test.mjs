import test from "node:test";
import assert from "node:assert/strict";
import worker from "../ceoai-index-v5.0.mjs";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";

function request() {
  return new Request("https://ceoai.dev/api/chat", {
    method: "POST",
    headers: {
      "Origin": "https://ceoai.dev",
      "Content-Type": "application/json",
      "Cookie": "ceoai_session=" + sessionId,
      "CF-Connecting-IP": "203.0.113.10",
    },
    body: JSON.stringify({ prompt: "test request" }),
  });
}

function envWithSession() {
  const calls = [];
  return {
    calls,
    env: {
      AI_ENABLED: "false",
      ALLOWED_ORIGINS: "https://ceoai.dev",
      KV_MEMORY: {
        async get(key) {
          calls.push(["get", key]);
          return key === "session:" + sessionId ? "1" : null;
        },
        async put(...args) { calls.push(["put", ...args]); },
      },
    },
  };
}

test("chat fails closed when native RATE_LIMITER binding is missing", async () => {
  const { env, calls } = envWithSession();
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /zaštita|preopterećenja/i);
  assert.deepEqual(calls, [], "rate limiter must run before session KV reads");
  assert.equal(calls.some(call => call[0] === "put"), false);
});

test("chat rejects requests when native RATE_LIMITER denies the key", async () => {
  const { env } = envWithSession();
  const keys = [];
  env.RATE_LIMITER = {
    async limit(input) { keys.push(input.key); return { success: false }; },
  };
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(keys, ["203.0.113.10"]);
});

test("chat fails closed when native RATE_LIMITER throws", async () => {
  const { env } = envWithSession();
  let calls = 0;
  env.RATE_LIMITER = {
    async limit() { calls++; throw new Error("internal limiter failure"); },
  };
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.equal((await response.json()).success, false);
});

test("chat proceeds past rate limiting only when native RATE_LIMITER allows", async () => {
  const { env } = envWithSession();
  const keys = [];
  env.RATE_LIMITER = {
    async limit(input) { keys.push(input.key); return { success: true }; },
  };
  const response = await worker.fetch(request(), env);
  // AI is deliberately disabled: reaching this response proves the limiter allowed the request.
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /AI je isključen/i);
  assert.deepEqual(keys, ["203.0.113.10"]);
});
