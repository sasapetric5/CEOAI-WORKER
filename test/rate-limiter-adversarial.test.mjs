import test from "node:test";
import assert from "node:assert/strict";
import worker from "../ceoai-index-v5.0.mjs";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";

function request(ip = "203.0.113.10") {
  return new Request("https://ceoai.dev/api/chat", {
    method: "POST",
    headers: {
      "Origin": "https://ceoai.dev",
      "Content-Type": "application/json",
      "Cookie": "ceoai_session=" + sessionId,
      "CF-Connecting-IP": ip,
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

test("IPv6 privacy-address rotation shares one /64 rate-limit bucket", async () => {
  const { env } = envWithSession();
  const keys = [];
  env.RATE_LIMITER = {
    async limit(input) { keys.push(input.key); return { success: true }; },
  };
  const first = await worker.fetch(request("2001:db8:abcd:12::1"), env);
  const second = await worker.fetch(request("2001:db8:abcd:12:ffff::2"), env);
  assert.equal(first.status, 503); // the test has no valid session, but rate limiting runs first
  assert.equal(second.status, 503);
  assert.deepEqual(keys, ["ipv6-64:2001:0db8:abcd:0012", "ipv6-64:2001:0db8:abcd:0012"]);
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
