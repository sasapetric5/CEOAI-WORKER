import test from "node:test";
import assert from "node:assert/strict";
import { handleOpenAIChatCompletions } from "../src/openai-compat.mjs";
function env(extra={}){const data=new Map();return{GATEWAY_SECRET:"test-secret-with-at-least-16",AI_ENABLED:"true",EXTERNAL_AI_ENABLED:"true",KV_MEMORY:{async get(k){return data.get(k)??null},async put(k,v){data.set(k,v)}},...extra}}
function req(body,options={}){return new Request("https://ceoai.dev/v1/chat/completions",{method:options.method||"POST",headers:{Authorization:"Bearer test-secret-with-at-least-16","Content-Type":"application/json",...(options.headers||{})},body:options.method==="GET"?undefined:JSON.stringify(body)})}
test("unauthorized requests are rejected before provider calls",async()=>{const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected")};try{const r=await handleOpenAIChatCompletions(new Request("https://ceoai.dev/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer wrong","Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:"Hi"}]})}),env());assert.equal(r.status,401);assert.equal(calls,0)}finally{globalThis.fetch=old}});
test("AI remains fail-closed until both owner flags are true",async()=>{const r=await handleOpenAIChatCompletions(req({messages:[{role:"user",content:"Hi"}]}),env({AI_ENABLED:"false"}));assert.equal(r.status,503);assert.equal((await r.json()).error.code,"ai_disabled")});
test("validates roles, streaming and tools before provider calls",async()=>{const e=env();const a=await handleOpenAIChatCompletions(req({messages:[{role:"developer",content:"no"}]}),e);assert.equal(a.status,400);const b=await handleOpenAIChatCompletions(req({stream:true,messages:[{role:"user",content:"hi"}]}),e);assert.equal((await b.json()).error.code,"streaming_not_supported_yet");const c=await handleOpenAIChatCompletions(req({tools:[],messages:[{role:"user",content:"hi"}]}),e);assert.equal((await c.json()).error.code,"tools_not_supported_yet")});
test("OpenRouter :free produces standard chat.completion response",async()=>{const old=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(String(url),"https://openrouter.ai/api/v1/chat/completions");assert.equal(JSON.parse(options.body).model,"meta-llama/llama-3-8b-instruct:free");return new Response(JSON.stringify({choices:[{message:{content:"Gateway works"}}]}),{status:200})};try{const r=await handleOpenAIChatCompletions(req({model:"ceoai-auto",messages:[{role:"user",content:"Hi"}]}),env({OPENROUTER_KEY:"test-key"}));assert.equal(r.status,200);const d=await r.json();assert.equal(d.object,"chat.completion");assert.equal(d.choices[0].message.content,"Gateway works");assert.equal(r.headers.get("cache-control"),"no-store")}finally{globalThis.fetch=old}});
test("Gemini is excluded unless owner has explicitly enforced free-only mode",async()=>{const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected")};try{const r=await handleOpenAIChatCompletions(req({messages:[{role:"user",content:"Hi"}]}),env({GEMINI_KEY_1:"test-gemini-key",GEMINI_FREE_CONFIRMED:"true"}));assert.equal(r.status,503);assert.equal((await r.json()).error.code,"no_free_provider");assert.equal(calls,0)}finally{globalThis.fetch=old}});

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
