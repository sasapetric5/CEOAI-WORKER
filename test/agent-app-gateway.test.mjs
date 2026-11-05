import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import worker,{runConfiguredProviderCompletion} from "../ceoai-index-v5.0.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret="test-contentcraft-agent-secret-at-least-32-bytes";
const appId="CONTENTCRAFT-APP";
const encoder=new TextEncoder();
function environment(extra={}){
 const seen=new Set(),memory=new Map();
 return {
  AI_ENABLED:"true",
  OPENROUTER_FREE_CONFIRMED:"true",
  OPENROUTER_KEY:"test-openrouter-key",
  HMAC_ALLOWED_APPS:"CONTENTCRAFT-APP,AIFORCE-APP,RANKGEO-APP",
  APP_SECRET_CONTENTCRAFT_APP:secret,
  KV_MEMORY:{async get(k){return memory.get(k)??null;},async put(k,v){memory.set(k,v);},async delete(k){memory.delete(k);}},
  RATE_LIMITER:{async limit({key}){return {success:true,key};}},
  SECURITY_DO:{idFromName(name){return name;},get(){return {async fetch(_url,options){const {appId,nonce}=JSON.parse(options.body),key=appId+":"+nonce;if(seen.has(key))return Response.json({error:"replay"},{status:409});seen.add(key);return Response.json({success:true});}};}},
  ...extra,
 };
}
async function signedRequest(body,{id=appId,path="/v1/agents/run",nonce}={}){
 const raw=typeof body==="string"?body:JSON.stringify(body);
 const timestamp=String(Math.floor(Date.now()/1000));
 nonce??=("agent_nonce_"+crypto.randomUUID().replaceAll("-",""));
 const hash=await crypto.subtle.digest("SHA-256",encoder.encode(raw));
 const hex=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
 const canonical=["POST",path,timestamp,nonce,hex].join("\n");
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("HMAC",key,encoder.encode(canonical));
 return new Request("https://ceoai.test"+path,{method:"POST",headers:{
  "Content-Type":"application/json","X-App-Id":id,"X-Timestamp":timestamp,"X-Nonce":nonce,"X-Signature":Buffer.from(signature).toString("base64")
 },body:raw});
}
function mockFreeModel(){
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;
  assert.equal(String(url),"https://openrouter.ai/api/v1/chat/completions");
  const payload=JSON.parse(options.body);
  assert.match(payload.model,/:free$/);
  const isSynthesis=payload.messages[0].content.includes("završni koordinator");
  const content=isSynthesis?JSON.stringify({output:"Objedinjena analiza je završena."}):JSON.stringify({type:"final",output:"Analiza zadatka je završena."});
  return Response.json({choices:[{message:{content}}]});
 };
 return {restore(){globalThis.fetch=old;},get calls(){return calls;}};
}
test("agent provider refuses keyed but unconfirmed paid providers",async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("must not call provider");};
 try{
  const env={AI_ENABLED:"true",DEEPSEEK_KEY:"test-deepseek-key",KV_MEMORY:{async get(){return null;},async put(){}}};
  const result=await runConfiguredProviderCompletion(env,[{role:"user",content:"hello"}],"reasoning");
  assert.deepEqual(result,{ok:false,code:"NO_FREE_PROVIDER_CONFIRMED"});
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});
test("agent provider uses only an explicitly confirmed OpenRouter free model",async()=>{
 const mock=mockFreeModel();
 try{
  const env={...environment(),OPENROUTER_FREE_CONFIRMED:"true"};
  const result=await runConfiguredProviderCompletion(env,[{role:"user",content:"hello"}],"reasoning");
  assert.equal(result.ok,true);assert.equal(result.providerId,"openrouter-1");assert.equal(mock.calls,1);
 }finally{mock.restore();}
});
test("HMAC app gateway invokes specialist system with no exposed tool permissions",async()=>{
 const mock=mockFreeModel();
 try{
  const response=await worker.fetch(await signedRequest({task:"regression testing and verification",input:{component:"ContentCraft"},limit:1}),environment());
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.success,true);
  assert.equal(data.reply,"Objedinjena analiza je završena.");
  assert.equal(data.agents[0],"quality_engineer");
  assert.equal(data.modelUsage.used,2);
  assert.equal(mock.calls,2);
 }finally{mock.restore();}
});
test("agent gateway rejects missing HMAC before any model call",async()=>{
 const mock=mockFreeModel();
 try{
  const response=await worker.fetch(new Request("https://ceoai.test/v1/agents/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task:"test"})}),environment());
  assert.equal(response.status,401);assert.equal((await response.json()).code,"UNAUTHORIZED");assert.equal(mock.calls,0);
 }finally{mock.restore();}
});
test("agent gateway rejects app IDs outside its explicit application policy",async()=>{
 const mock=mockFreeModel();
 try{
  const env=environment({HMAC_ALLOWED_APPS:"CONTENTCRAFT-APP,AIFORCE-APP,UNKNOWN-APP",APP_SECRET_UNKNOWN_APP:secret});
  const response=await worker.fetch(await signedRequest({task:"test"},{id:"UNKNOWN-APP"}),env);
  assert.equal(response.status,403);assert.equal((await response.json()).code,"APP_NOT_ENABLED");assert.equal(mock.calls,0);
 }finally{mock.restore();}
});
test("agent gateway rejects unknown request fields and oversized input",async()=>{
 const mock=mockFreeModel();
 try{
  const unknown=await worker.fetch(await signedRequest({task:"test",allowToolExecution:true}),environment());
  assert.equal(unknown.status,400);assert.equal((await unknown.json()).code,"INVALID_REQUEST");
  const tooLarge=await worker.fetch(await signedRequest({task:"test",input:{blob:"x".repeat(4100)}}),environment());
  assert.equal(tooLarge.status,400);assert.equal((await tooLarge.json()).code,"INVALID_AGENT_REQUEST");
  assert.equal(mock.calls,0);
 }finally{mock.restore();}
});
test("agent gateway fails closed when the rate limiter is unavailable",async()=>{
 const mock=mockFreeModel();
 try{
  const response=await worker.fetch(await signedRequest({task:"test"}),environment({RATE_LIMITER:null}));
  assert.equal(response.status,503);assert.equal((await response.json()).code,"RATE_LIMITER_UNAVAILABLE");assert.equal(mock.calls,0);
 }finally{mock.restore();}
});
test("agent gateway enforces per-application rate limiting",async()=>{
 const mock=mockFreeModel();
 try{
  const response=await worker.fetch(await signedRequest({task:"test"}),environment({RATE_LIMITER:{async limit(){return {success:false};}}}));
  assert.equal(response.status,429);assert.equal((await response.json()).code,"RATE_LIMITED");assert.equal(mock.calls,0);
 }finally{mock.restore();}
});
test("agent gateway consumes HMAC nonce and rejects replay before model call",async()=>{
 const mock=mockFreeModel();
 try{
  const env=environment(),req=await signedRequest({task:"test"},{nonce:"agent_replay_nonce_123456789"});
  const first=await worker.fetch(req,env);assert.equal(first.status,200);
  const second=await worker.fetch(await signedRequest({task:"test"},{nonce:"agent_replay_nonce_123456789"}),env);
  assert.equal(second.status,401);assert.equal(mock.calls,2);
 }finally{mock.restore();}
});
test("agent gateway allows only POST",async()=>{
 const response=await worker.fetch(new Request("https://ceoai.test/v1/agents/run",{method:"GET"}),environment());
 assert.equal(response.status,405);assert.equal(response.headers.get("allow"),"POST");
});

test("mixed configured providers never call any provider without explicit free confirmation",async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error("unconfirmed provider must never be called");};
 try{
  const env={
   AI_ENABLED:"true",KV_MEMORY:{async get(){return null;},async put(){}},
   ZAI_GLM_FLASH_KEY_1:"test-glm-key",
   GEMINI_API_KEY_PRIMARY:"test-gemini-key",
   OPENROUTER_KEY:"test-openrouter-key",
   DEEPSEEK_API_KEY:"test-deepseek-key",
   MISTRAL_API_KEY:"test-mistral-key",
   XAI_API_KEY:"test-xai-key",
   NVIDIA_API_KEY:"test-nvidia-key",
   HF_TOKEN:"test-hf-token",
  };
  const result=await runConfiguredProviderCompletion(env,[{role:"user",content:"bounded test"}],"reasoning");
  assert.deepEqual(result,{ok:false,code:"NO_FREE_PROVIDER_CONFIRMED"});
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});


test("agent gateway rejects malformed HMAC signature before model call",async()=>{
 const mock=mockFreeModel();
 try{
  const req=await signedRequest({task:"security review"});
  req.headers.set("X-Signature","not-a-valid-signature");
  const response=await worker.fetch(req,environment());
  assert.equal(response.status,401);
  assert.equal((await response.json()).code,"UNAUTHORIZED");
  assert.equal(mock.calls,0);
 }finally{mock.restore();}
});

test("agent gateway fails closed when HMAC secret is unavailable",async()=>{
 const mock=mockFreeModel();
 try{
  const response=await worker.fetch(await signedRequest({task:"security review"}),environment({APP_SECRET_CONTENTCRAFT_APP:undefined}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,"AUTH_UNAVAILABLE");
  assert.equal(mock.calls,0);
 }finally{mock.restore();}
});

test("agent gateway fails closed when durable nonce protection is unavailable",async()=>{
 const mock=mockFreeModel();
 try{
  const response=await worker.fetch(await signedRequest({task:"security review"}),environment({SECURITY_DO:null}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,"AUTH_UNAVAILABLE");
  assert.equal(mock.calls,0);
 }finally{mock.restore();}
});

test("agent gateway rejects non-JSON content type before authentication or model call",async()=>{
 const mock=mockFreeModel();
 try{
  const response=await worker.fetch(new Request("https://ceoai.test/v1/agents/run",{method:"POST",headers:{"Content-Type":"text/plain"},body:"{}"}),environment());
  assert.equal(response.status,415);
  assert.equal((await response.json()).code,"INVALID_CONTENT_TYPE");
  assert.equal(mock.calls,0);
 }finally{mock.restore();}
});

test("shared Spider capability is available to AI Force with isolated app identity",async()=>{
 let sends=0;
 const env=environment({
  APP_SECRET_AIFORCE_APP:secret,
  SPIDER_BROWSER_RUN_ACCOUNT_ID:"test-account",
  SPIDER_BROWSER_RUN_TOKEN:"test-runner-token",
  SPIDER_QUEUE:{async send(message){sends++;assert.equal(message.appId,"AIFORCE-APP");assert.equal(message.id,"123e4567-e89b-42d3-a456-426614174000");}}
 });
 const response=await worker.fetch(await signedRequest({
  url:"https://example.com",requestId:"123e4567-e89b-42d3-a456-426614174000"
 },{id:"AIFORCE-APP",path:"/v1/spider/crawl"}),env);
 const payload=await response.json();
 assert.equal(response.status,202,JSON.stringify(payload));
 assert.equal(sends,1);
});
test("Spider capability remains available to authorized ContentCraft policy",async()=>{
 let sends=0;
 const env=environment({
  SPIDER_BROWSER_RUN_ACCOUNT_ID:"test-account",
  SPIDER_BROWSER_RUN_TOKEN:"test-runner-token",
  SPIDER_QUEUE:{async send(message){sends++;assert.equal(message.id,"123e4567-e89b-42d3-a456-426614174000");}}
 });
 const response=await worker.fetch(await signedRequest({
  url:"https://example.com",requestId:"123e4567-e89b-42d3-a456-426614174000"
 },{id:"CONTENTCRAFT-APP",path:"/v1/spider/crawl"}),env);
 const payload=await response.json();
 assert.equal(response.status,202,JSON.stringify(payload));
 assert.equal(sends,1);
});


// HMAC-authenticated OpenAI-compatible gateway: application-level isolation.
test("model gateway applies a distinct rate-limit bucket for each authenticated app",async()=>{
 const old=globalThis.fetch;const keys=[];
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:"gateway-ok"}}]});
 try{
  const env=environment({
   APP_SECRET_AIFORCE_APP:secret,
   AI_ENABLED:"true",EXTERNAL_AI_ENABLED:"true",
   OPENROUTER_FREE_CONFIRMED:"true",OPENROUTER_KEY:"test-openrouter-key",
   RATE_LIMITER:{async limit({key}){keys.push(key);return {success:true};}}
  });
  for(const id of ["CONTENTCRAFT-APP","AIFORCE-APP"]){
   const response=await worker.fetch(await signedRequest({messages:[{role:"user",content:"hello"}]},{id,path:"/v1/chat/completions"}),env);
   assert.equal(response.status,200);
  }
  assert.deepEqual(keys,["gateway:CONTENTCRAFT-APP","gateway:AIFORCE-APP"]);
 }finally{globalThis.fetch=old;}
});

test("model gateway fails closed when an authenticated app exceeds its own rate limit",async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error("provider must not be called");};
 try{
  const env=environment({
   AI_ENABLED:"true",EXTERNAL_AI_ENABLED:"true",
   OPENROUTER_FREE_CONFIRMED:"true",OPENROUTER_KEY:"test-openrouter-key",
   RATE_LIMITER:{async limit({key}){assert.equal(key,"gateway:CONTENTCRAFT-APP");return {success:false};}}
  });
  const response=await worker.fetch(await signedRequest({messages:[{role:"user",content:"hello"}]},{path:"/v1/chat/completions"}),env);
  assert.equal(response.status,429);
  assert.equal((await response.json()).error.code,"rate_limited");
  assert.equal(response.headers.get("retry-after"),"60");
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});

test("model gateway fails closed when the authenticated app rate limiter is unavailable",async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error("provider must not be called");};
 try{
  const env=environment({
   AI_ENABLED:"true",EXTERNAL_AI_ENABLED:"true",
   OPENROUTER_FREE_CONFIRMED:"true",OPENROUTER_KEY:"test-openrouter-key",
   RATE_LIMITER:null
  });
  const response=await worker.fetch(await signedRequest({messages:[{role:"user",content:"hello"}]},{path:"/v1/chat/completions"}),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error.code,"rate_limiter_unavailable");
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});

test("each application receives only its own specialist-agent allowlist",async()=>{
 const mock=mockFreeModel();
 try{
  const env=environment({APP_SECRET_AIFORCE_APP:secret,APP_SECRET_RANKGEO_APP:secret});
  const cases=[
   {id:"CONTENTCRAFT-APP",task:"security review HMAC authentication permissions",expected:"security_reviewer"},
   {id:"AIFORCE-APP",task:"Cloudflare Workers Durable Objects platform architecture",expected:"cloudflare_platform_engineer"},
   {id:"RANKGEO-APP",task:"crawler queue retries idempotency spider reliability",expected:"crawler_reliability_engineer"},
  ];
  for(const item of cases){
   const response=await worker.fetch(await signedRequest({task:item.task,limit:1},{id:item.id}),env);
   assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
   const data=await response.json();
   assert.equal(data.success,true);
   assert.deepEqual(data.agents,[item.expected]);
  }
  assert.equal(mock.calls,6);
 }finally{mock.restore();}
});


test("agent gateway persists and reloads conversation memory only within each authenticated app",async()=>{
 const old=globalThis.fetch;const providerPayloads=[];
 globalThis.fetch=async(url,options)=>{
  const payload=JSON.parse(options.body);providerPayloads.push(payload);
  const synthesis=payload.messages[0].content.includes("završni koordinator");
  const content=synthesis?JSON.stringify({output:"Odgovor "+providerPayloads.length}):JSON.stringify({type:"final",output:"Analiza "+providerPayloads.length});
  return Response.json({choices:[{message:{content}}]});
 };
 try{
  const env=environment({APP_SECRET_AIFORCE_APP:secret,APP_SECRET_RANKGEO_APP:secret});
  const conversationId="123e4567-e89b-42d3-a456-426614174099";
  const send=async(id,nonce,task)=>worker.fetch(await signedRequest({task,conversation_id:conversationId},{id,nonce}),env);
  assert.equal((await send("CONTENTCRAFT-APP","agent_mem_cc_000000000001","regression testing and verification contentcraft private task")).status,200);
  assert.equal((await send("AIFORCE-APP","agent_mem_af_000000000001","Cloudflare Workers platform architecture aiforce private task")).status,200);
  assert.equal((await send("CONTENTCRAFT-APP","agent_mem_cc_000000000002","regression testing and verification contentcraft follow-up")).status,200);
  const payloadText=providerPayloads.map(p=>JSON.stringify(p.messages));
  assert.equal(payloadText.some(v=>v.includes("contentcraft private task")),true);
  assert.equal(payloadText.some(v=>v.includes("aiforce private task")),true);
  const thirdCallText=JSON.stringify(providerPayloads.slice(-2));
  assert.equal(thirdCallText.includes("contentcraft private task"),true);
  assert.equal(thirdCallText.includes("aiforce private task"),false);
 }finally{globalThis.fetch=old;}
});

test("agent gateway validates conversation UUID and keeps requests stateless when omitted",async()=>{
 const mock=mockFreeModel();
 try{
  const env=environment();
  const invalid=await worker.fetch(await signedRequest({task:"invalid session",conversation_id:"../other-app"}),env);
  assert.equal(invalid.status,400);
  assert.equal((await invalid.json()).code,"INVALID_AGENT_REQUEST");
  const stateless=await worker.fetch(await signedRequest({task:"regression testing and verification without persistent session"}),env);
  assert.equal(stateless.status,200);
 }finally{mock.restore();}
});

test("agent gateway fails closed when app memory storage is unavailable",async()=>{
 const mock=mockFreeModel();
 try{
  const brokenKV={async get(){throw new Error("storage down");},async put(){},async delete(){}};
  const env=environment({KV_MEMORY:brokenKV});
  const response=await worker.fetch(await signedRequest({
   task:"must not run without isolated memory",
   conversation_id:"123e4567-e89b-42d3-a456-426614174098"
  }),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,"APP_MEMORY_UNAVAILABLE");
  assert.equal(mock.calls,0);
 }finally{mock.restore();}
});
