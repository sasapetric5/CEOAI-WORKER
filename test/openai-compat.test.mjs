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

