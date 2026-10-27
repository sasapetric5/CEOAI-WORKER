import test from "node:test";
import assert from "node:assert/strict";
import { handleOpenAIChatCompletions } from "../src/openai-compat.mjs";
function env(extra={}){const data=new Map();return{GATEWAY_SECRET:"test-secret-with-at-least-16",AI_ENABLED:"true",EXTERNAL_AI_ENABLED:"true",KV_MEMORY:{async get(k){return data.get(k)??null},async put(k,v){data.set(k,v)}},...extra}}
function req(body,options={}){return new Request("https://ceoai.dev/v1/chat/completions",{method:options.method||"POST",headers:{Authorization:"Bearer test-secret-with-at-least-16","Content-Type":"application/json",...(options.headers||{})},body:options.method==="GET"?undefined:JSON.stringify(body)})}
test("unauthorized requests are rejected before provider calls",async()=>{const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected")};try{const r=await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer wrong","Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:"Hi"}]})}),env());assert.equal(r.status,401);assert.equal(calls,0)}finally{globalThis.fetch=old}});
test("AI remains fail-closed until both owner flags are true",async()=>{const r=await handleOpenAIChatCompletions(req({messages:[{role:"user",content:"Hi"}]}),env({AI_ENABLED:"false"}));assert.equal(r.status,503);assert.equal((await r.json()).error.code,"ai_disabled")});
test("validates roles, streaming and tools before provider calls",async()=>{const e=env();const a=await handleOpenAIChatCompletions(req({messages:[{role:"developer",content:"no"}]}),e);assert.equal(a.status,400);const b=await handleOpenAIChatCompletions(req({stream:true,messages:[{role:"user",content:"hi"}]}),e);assert.equal((await b.json()).error.code,"streaming_not_supported_yet");const c=await handleOpenAIChatCompletions(req({tools:[],messages:[{role:"user",content:"hi"}]}),e);assert.equal((await c.json()).error.code,"tools_not_supported_yet")});
test("OpenRouter :free produces standard chat.completion response",async()=>{const old=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(String(url),"https://openrouter.ai/api/v1/chat/completions");assert.equal(JSON.parse(options.body).model,"meta-llama/llama-3-8b-instruct:free");return new Response(JSON.stringify({choices:[{message:{content:"Gateway works"}}]}),{status:200})};try{const r=await handleOpenAIChatCompletions(req({model:"ceoai-auto",messages:[{role:"user",content:"Hi"}]}),env({OPENROUTER_KEY:"test-key"}));assert.equal(r.status,200);const d=await r.json();assert.equal(d.object,"chat.completion");assert.equal(d.choices[0].message.content,"Gateway works");assert.equal(r.headers.get("cache-control"),"no-store")}finally{globalThis.fetch=old}});
test("Gemini key is rejected unless owner explicitly confirms free-tier eligibility",async()=>{const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected")};try{const r=await handleOpenAIChatCompletions(req({messages:[{role:"user",content:"Hi"}]}),env({GEMINI_KEY_1:"test-gemini-key"}));assert.equal(r.status,503);assert.equal((await r.json()).error.code,"no_free_provider");assert.equal(calls,0)}finally{globalThis.fetch=old}});

test("Worker rutuira /v1/chat/completions do gateway modula", async () => {
  const worker = (await import("../ceoai-index-v5.0.mjs")).default;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "Worker route OK" } }] }), { status: 200 });
  try {
    const e = env({ OPENROUTER_KEY: "test-key" });
    const response = await worker.fetch(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret-with-at-least-16", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "ceoai-auto", messages: [{ role: "user", content: "Hi" }] }),
    }), e);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.object, "chat.completion");
    assert.equal(data.choices[0].message.content, "Worker route OK");
  } finally { globalThis.fetch = oldFetch; }
});

test("Gemini free-only mode selects a current free-tier model and uses header auth", async () => {
  const old = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url: String(url), headers: options.headers, payload: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini free path OK" }] } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true",
      GEMINI_FREE_ONLY: "true",
      OPENROUTER_KEY: "",
    }));
    assert.equal(r.status, 200);
    assert.match(observed.url, /models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(observed.headers["x-goog-api-key"], "test-gemini-key");
    assert.equal(observed.url.includes("test-gemini-key"), false);
    assert.equal((await r.json()).choices[0].message.content, "Gemini free path OK");
  } finally { globalThis.fetch = old; }
});

test("Gemini provider is excluded when free-only policy is explicitly disabled", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true",
      GEMINI_FREE_ONLY: "false",
      OPENROUTER_KEY: "",
    }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "no_free_provider");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});


test("rejects GET requests without contacting a provider", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({}, { method: "GET" }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("allow"), "POST");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("rejects malformed JSON before provider selection", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret-with-at-least-16", "Content-Type": "application/json" },
      body: "{broken-json",
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_json");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("rejects oversized request bodies with 413", async () => {
  const body = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(17000) }] });
  const r = await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer test-secret-with-at-least-16", "Content-Type": "application/json" },
    body,
  }), env({ OPENROUTER_KEY: "test-key" }));
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error.code, "request_too_large");
});

test("skips a provider in cooldown and does not send a request to it", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  const data = new Map([["gateway:cooldown:openrouter-free", "1"]]);
  const e = env({
    OPENROUTER_KEY: "test-key",
    KV_MEMORY: {
      async get(k) { return data.get(k) ?? null; },
      async put(k, v) { data.set(k, v); },
    },
  });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), e);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "providers_unavailable");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("provider quota errors set cooldown and return a retry hint when no fallback exists", async () => {
  const oldFetch = globalThis.fetch;
  const data = new Map();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
    status: 429, headers: { "Content-Type": "application/json" },
  });
  const e = env({
    OPENROUTER_KEY: "test-key",
    KV_MEMORY: {
      async get(k) { return data.get(k) ?? null; },
      async put(k, v, options) { data.set(k, v); data.set(k + ":ttl", options?.expirationTtl); },
    },
  });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), e);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("retry-after"), "60");
    assert.equal((await r.json()).error.code, "free_quota_exhausted");
    assert.equal(data.get("gateway:cooldown:openrouter-free"), "1");
    assert.ok(data.get("gateway:cooldown:openrouter-free:ttl") >= 60);
  } finally { globalThis.fetch = oldFetch; }
});


test("provider 5xx failure is cooled down and surfaced as unavailable", async () => {
  const oldFetch = globalThis.fetch;
  const data = new Map();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "upstream failure" } }), { status: 503 });
  };
  const e = env({
    OPENROUTER_KEY: "test-key",
    KV_MEMORY: {
      async get(k) { return data.get(k) ?? null; },
      async put(k, v, options) { data.set(k, v); data.set(k + ":ttl", options?.expirationTtl); },
    },
  });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), e);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "providers_unavailable");
    assert.equal(calls, 1);
    assert.equal(data.get("gateway:cooldown:openrouter-free"), "1");
  } finally { globalThis.fetch = oldFetch; }
});

test("empty provider output does not become a successful empty assistant message", async () => {
  const oldFetch = globalThis.fetch;
  const data = new Map();
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 });
  const e = env({
    OPENROUTER_KEY: "test-key",
    KV_MEMORY: {
      async get(k) { return data.get(k) ?? null; },
      async put(k, v) { data.set(k, v); },
    },
  });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), e);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "providers_unavailable");
  } finally { globalThis.fetch = oldFetch; }
});

test("model override cannot select a paid OpenRouter model through the auto route", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "no_free_provider");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("client-supplied provider credentials are ignored", async () => {
  const oldFetch = globalThis.fetch;
  let observedAuth = "";
  globalThis.fetch = async (_url, options) => {
    observedAuth = options.headers.Authorization || "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({
      api_key: "client-controlled-secret",
      provider: "openai",
      messages: [{ role: "user", content: "Hi" }],
    }), env({ OPENROUTER_KEY: "server-side-test-key" }));
    assert.equal(r.status, 200);
    assert.equal(observedAuth, "Bearer server-side-test-key");
    assert.equal(observedAuth.includes("client-controlled-secret"), false);
  } finally { globalThis.fetch = oldFetch; }
});

// Batch gateway validation regressions: message bounds, model allowlist, token clamp, and sanitized failures.
test("requires at least one user message before provider selection", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "assistant", content: "hello" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "user_message_required");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("rejects more than 16 messages before provider calls", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected"); };
  try {
    const messages = Array.from({ length: 17 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "m" + i }));
    const r = await handleOpenAIChatCompletions(req({ messages }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_messages");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("refuses a client-selected non-free model instead of routing to it", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ model: "vendor/paid-model", messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "no_free_provider");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("clamps requested max_tokens to 2048 before sending provider request", async () => {
  const oldFetch = globalThis.fetch; let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ max_tokens: 999999, messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 200);
    assert.equal(payload.max_tokens, 2048);
  } finally { globalThis.fetch = oldFetch; }
});

test("provider HTTP error details and tokens are never returned to API clients", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Authorization: Bearer private-upstream-token", { status: 500 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.doesNotMatch(body, /private-upstream-token|Authorization: Bearer/);
    assert.match(body, /providers_unavailable/);
  } finally { globalThis.fetch = oldFetch; }
});

// Batch provider fallback regressions: malformed and empty provider output, cooldown, and retry policy.
test("rejects empty provider content without returning an empty success", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "providers_unavailable");
  } finally { globalThis.fetch = oldFetch; }
});

test("rejects malformed provider JSON without leaking parser details", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{not-json", { status: 200 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.match(body, /providers_unavailable/);
    assert.doesNotMatch(body, /SyntaxError|not-json/);
  } finally { globalThis.fetch = oldFetch; }
});

test("quota cooldown is persisted without storing upstream error body", async () => {
  const oldFetch = globalThis.fetch; const data = new Map();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "private billing diagnostic" } }), { status: 429 });
  const e = env({ OPENROUTER_KEY: "test-key", KV_MEMORY: { async get(k){return data.get(k)??null}, async put(k,v){data.set(k,v)} } });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), e);
    assert.equal(r.status, 503);
    assert.equal(data.get("gateway:cooldown:openrouter-free"), "1");
    assert.doesNotMatch([...data.values()].join(" "), /private billing diagnostic/);
  } finally { globalThis.fetch = oldFetch; }
});

test("provider Retry-After is bounded to at most one hour in cooldown", async () => {
  const oldFetch = globalThis.fetch; const expirations = [];
  globalThis.fetch = async () => new Response("unavailable", { status: 503, headers: { "Retry-After": "99999" } });
  const e = env({ OPENROUTER_KEY: "test-key", KV_MEMORY: { async get(){return null}, async put(_k,_v,opts){expirations.push(opts.expirationTtl)} } });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), e);
    assert.equal(r.status, 503);
    assert.deepEqual(expirations, [3600]);
  } finally { globalThis.fetch = oldFetch; }
});

// Batch request boundary regressions: malformed JSON, oversized payload, and disabled gateway.
test("rejects malformed JSON with a stable error code", async () => {
  const malformed = new Request("https://ceoai.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer test-secret-with-at-least-16", "Content-Type": "application/json" },
    body: "{bad-json",
  });
  const r = await handleOpenAIChatCompletions(malformed, env({ OPENROUTER_KEY: "test-key" }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "invalid_json");
});

test("rejects oversized request bodies before provider calls", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not call provider"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "x".repeat(20000) }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 413);
    assert.equal((await r.json()).error.code, "request_too_large");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("disabled gateway rejects valid requests without provider calls", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not call provider"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ AI_ENABLED: "false", EXTERNAL_AI_ENABLED: "false", OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "ai_disabled");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

// Security/free-only batch: authorization, fail-closed storage, and request-boundary checks.
test("missing Authorization header is rejected before provider calls", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 401);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("gateway refuses a too-short configured server secret", async () => {
  const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
    GATEWAY_SECRET: "short", OPENROUTER_KEY: "test-key",
  }));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, "unauthorized");
});

test("Bearer authorization scheme is required", async () => {
  const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }, {
    headers: { Authorization: "Basic dGVzdA==" },
  }), env({ OPENROUTER_KEY: "test-key" }));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, "unauthorized");
});

test("gateway fails closed when the KV binding is absent", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      KV_MEMORY: undefined, OPENROUTER_KEY: "test-key",
    }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "storage_unavailable");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("gateway fails closed when KV get is not callable", async () => {
  const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
    KV_MEMORY: { async put() {} }, OPENROUTER_KEY: "test-key",
  }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, "storage_unavailable");
});

test("missing free provider configuration returns a generic error without network access", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "", GEMINI_KEY_1: "", WORKERS_AI_ENABLED: "true",
    }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "no_free_provider");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("tool_choice is rejected even when tools is omitted", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({
      tool_choice: "auto", messages: [{ role: "user", content: "Hi" }],
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "tools_not_supported_yet");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("empty message content is rejected before provider calls", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({
      messages: [{ role: "user", content: "   " }],
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_message");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("oversized individual message is rejected before provider calls", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({
      messages: [{ role: "user", content: "x".repeat(8001) }],
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "message_too_long");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("total message character budget is enforced before provider calls", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({
      messages: [
        { role: "user", content: "a".repeat(7000) },
        { role: "assistant", content: "b".repeat(7000) },
        { role: "user", content: "c" },
      ],
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "request_too_large");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("max_tokens lower bound is clamped to one", async () => {
  const oldFetch = globalThis.fetch; let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({
      max_tokens: -100, messages: [{ role: "user", content: "Hi" }],
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 200);
    assert.equal(payload.max_tokens, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test("API responses never echo the configured gateway secret", async () => {
  const secret = "test-secret-with-at-least-16";
  const r = await handleOpenAIChatCompletions(req({
    model: "paid model with spaces", messages: [{ role: "user", content: "Hi" }],
  }), env({ GATEWAY_SECRET: secret, OPENROUTER_KEY: "test-key" }));
  const body = await r.text();
  assert.doesNotMatch(body, new RegExp(secret));
  assert.doesNotMatch(body, /test-key/);
});

// AI router/recovery batch: deterministic mocked provider failures and fallback behavior.
test("falls back from OpenRouter 5xx to explicitly confirmed free Gemini", async () => {
  const oldFetch = globalThis.fetch; const stored = new Map(); const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push(String(url));
    if (String(url).includes("openrouter.ai")) return new Response("upstream unavailable", { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fallback-ok" }] } }] }), { status: 200 });
  };
  const e = env({
    OPENROUTER_KEY: "test-openrouter-key",
    GEMINI_KEY_1: "test-gemini-key",
    GEMINI_FREE_CONFIRMED: "true",
    GEMINI_FREE_ONLY: "true",
    KV_MEMORY: { async get(k) { return stored.get(k) ?? null; }, async put(k,v,o) { stored.set(k,v); stored.set(k+":ttl",o?.expirationTtl); } },
  });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), e);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "fallback-ok");
    assert.equal(seen.length, 2);
    assert.match(seen[0], /openrouter\.ai/);
    assert.match(seen[1], /generativelanguage\.googleapis\.com/);
    assert.equal(stored.get("gateway:cooldown:openrouter-free"), "1");
  } finally { globalThis.fetch = oldFetch; }
});

test("falls back after a simulated network error from the first provider", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (String(url).includes("openrouter.ai")) throw new TypeError("simulated network failure");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "recovered" }] } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-openrouter-key", GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true", GEMINI_FREE_ONLY: "true",
    }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "recovered");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test("falls back when the first provider returns malformed successful JSON", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (String(url).includes("openrouter.ai")) return new Response("{bad-json", { status: 200 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "second-provider-ok" }] } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-openrouter-key", GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true", GEMINI_FREE_ONLY: "true",
    }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "second-provider-ok");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test("does not call providers when cooldown KV read fails", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not call provider"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-key",
      KV_MEMORY: { async get() { throw new Error("KV read failed"); }, async put() {} },
    }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "storage_unavailable");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("cooldown write failure does not expose upstream details or break fallback", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (String(url).includes("openrouter.ai")) return new Response("private upstream diagnostic", { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fallback-survived" }] } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-openrouter-key", GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true", GEMINI_FREE_ONLY: "true",
      KV_MEMORY: { async get() { return null; }, async put() { throw new Error("KV write failed"); } },
    }));
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.match(body, /fallback-survived/);
    assert.doesNotMatch(body, /private upstream diagnostic|KV write failed/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test("skips cooling OpenRouter and successfully uses eligible Gemini fallback", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  const stored = new Map([["gateway:cooldown:openrouter-free", "1"]]);
  globalThis.fetch = async url => {
    calls++;
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "cooldown-fallback" }] } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-openrouter-key", GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true", GEMINI_FREE_ONLY: "true",
      KV_MEMORY: { async get(k) { return stored.get(k) ?? null; }, async put(k,v) { stored.set(k,v); } },
    }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "cooldown-fallback");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test("malformed Gemini response falls through to a generic unavailable response", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      GEMINI_KEY_1: "test-gemini-key", GEMINI_FREE_CONFIRMED: "true", GEMINI_FREE_ONLY: "true",
    }));
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.match(body, /providers_unavailable/);
    assert.doesNotMatch(body, /candidate|parts|test-gemini-key/i);
  } finally { globalThis.fetch = oldFetch; }
});

test("provider quota failure is surfaced with a generic quota code, not raw provider text", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "private billing account detail" } }), { status: 402 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.match(body, /free_quota_exhausted/);
    assert.doesNotMatch(body, /private billing account detail|test-key/);
  } finally { globalThis.fetch = oldFetch; }
});

test("non-retryable provider 4xx still permits fallback to another eligible provider", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (String(url).includes("openrouter.ai")) return new Response("bad request", { status: 400 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "recovered-from-4xx" }] } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-openrouter-key", GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true", GEMINI_FREE_ONLY: "true",
    }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "recovered-from-4xx");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test("all eligible providers failing returns stable generic 503 response", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes("openrouter.ai")) return new Response("private openrouter error", { status: 500 });
    return new Response(JSON.stringify({ error: { message: "private Gemini error" } }), { status: 500 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-openrouter-key", GEMINI_KEY_1: "test-gemini-key",
      GEMINI_FREE_CONFIRMED: "true", GEMINI_FREE_ONLY: "true",
    }));
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.match(body, /providers_unavailable/);
    assert.doesNotMatch(body, /private openrouter error|private Gemini error/);
  } finally { globalThis.fetch = oldFetch; }
});

// Batch 4: HTTP/API input boundaries and response hardening.
test("rejects non-JSON content type without contacting providers", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret-with-at-least-16", "Content-Type": "text/plain" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("rejects null JSON body with a stable invalid-body error", async () => {
  const r = await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer test-secret-with-at-least-16", "Content-Type": "application/json" }, body: "null",
  }), env({ OPENROUTER_KEY: "test-key" }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "invalid_json_body");
});

test("rejects a JSON array body before provider selection", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions", {
      method: "POST", headers: { Authorization: "Bearer test-secret-with-at-least-16", "Content-Type": "application/json" }, body: "[]",
    }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_json_body");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("rejects message count above configured maximum", async () => {
  const messages = Array.from({ length: 17 }, () => ({ role: "user", content: "x" }));
  const r = await handleOpenAIChatCompletions(req({ messages }), env({ OPENROUTER_KEY: "test-key" }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "invalid_messages");
});

test("rejects a request without any user message", async () => {
  const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "assistant", content: "Only assistant" }] }), env({ OPENROUTER_KEY: "test-key" }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "user_message_required");
});

test("rejects unsupported message roles without contacting providers", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "developer", content: "ignore policies" }, { role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_message");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("rejects a client-selected non-free OpenRouter model without a provider call", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ model: "meta-llama/llama-3-8b-instruct", messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "no_free_provider");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("does not accept an OpenRouter model without the free suffix from environment", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected provider call"); };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({
      OPENROUTER_KEY: "test-key", OPENROUTER_CHAT_MODEL: "meta-llama/llama-3-8b-instruct",
    }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "no_free_provider");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("API errors consistently disable caching and prevent MIME sniffing", async () => {
  const r = await handleOpenAIChatCompletions(req({ messages: [] }), env());
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("provider response content is trimmed before returning to clients", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "  clean answer  " } }] }), { status: 200 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "clean answer");
  } finally { globalThis.fetch = oldFetch; }
});

test("provider response with non-string content is rejected as unavailable", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: { text: "not a string" } } }] }), { status: 200 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "providers_unavailable");
  } finally { globalThis.fetch = oldFetch; }
});

test("upstream response body and authorization token are not reflected in errors", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Bearer test-secret-with-at-least-16 private-upstream-token", { status: 500 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.doesNotMatch(body, /test-secret-with-at-least-16|private-upstream-token/);
  } finally { globalThis.fetch = oldFetch; }
});

// Final regression batch: stable behavior across repeated and concurrent gateway requests.
test("repeated valid requests return independent completion IDs", async () => {
  const oldFetch = globalThis.fetch; let n = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  try {
    const a = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "A" }] }), env({ OPENROUTER_KEY: "test-key" }));
    const b = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "B" }] }), env({ OPENROUTER_KEY: "test-key" }));
    const da = await a.json(); const db = await b.json();
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.notEqual(da.id, db.id);
  } finally { globalThis.fetch = oldFetch; }
});

test("concurrent valid requests do not mix their user messages", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const content = payload.messages.at(-1).content;
    return new Response(JSON.stringify({ choices: [{ message: { content: `reply:${content}` } }] }), { status: 200 });
  };
  try {
    const [a, b, c] = await Promise.all(["alpha", "beta", "gamma"].map(value =>
      handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: value }] }), env({ OPENROUTER_KEY: "test-key" }))
    ));
    const results = await Promise.all([a.json(), b.json(), c.json()]);
    assert.deepEqual(results.map(x => x.choices[0].message.content), ["reply:alpha", "reply:beta", "reply:gamma"]);
  } finally { globalThis.fetch = oldFetch; }
});

test("rejected request does not poison a later valid request", async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), { status: 200 }); };
  try {
    const bad = await handleOpenAIChatCompletions(req({ messages: [] }), env({ OPENROUTER_KEY: "test-key" }));
    const good = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "valid" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(bad.status, 400);
    assert.equal(good.status, 200);
    assert.equal((await good.json()).choices[0].message.content, "recovered");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test("successful responses include JSON content type and no-store cache policy", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /application\/json/i);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  } finally { globalThis.fetch = oldFetch; }
});

test("upstream timeout-like abort does not expose stack or internal details", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { const e = new Error("private timeout internals"); e.name = "AbortError"; throw e; };
  try {
    const r = await handleOpenAIChatCompletions(req({ messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.match(body, /providers_unavailable/);
    assert.doesNotMatch(body, /private timeout internals|AbortError|stack/i);
  } finally { globalThis.fetch = oldFetch; }
});

test("invalid max_tokens types are normalized to a bounded safe integer", async () => {
  const oldFetch = globalThis.fetch; let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  try {
    const r = await handleOpenAIChatCompletions(req({ max_tokens: "999999", messages: [{ role: "user", content: "Hi" }] }), env({ OPENROUTER_KEY: "test-key" }));
    assert.equal(r.status, 200);
    assert.ok(Number.isInteger(payload.max_tokens));
    assert.ok(payload.max_tokens >= 1 && payload.max_tokens <= 2048);
  } finally { globalThis.fetch = oldFetch; }
});

test("oversized streaming request bodies are cancelled before full buffering", async () => {
  let cancelled = false;
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(8192));
      if (chunks >= 4) controller.close();
    },
    cancel() { cancelled = true; },
  });
  const response = await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-secret-with-at-least-16",
      "Content-Type": "application/json",
    },
    body,
    duplex: "half",
  }), env({ OPENROUTER_KEY: "test-key" }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(chunks <= 2, "reader should stop after crossing the configured body limit");
});
