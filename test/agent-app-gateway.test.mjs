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
  HMAC_ALLOWED_APPS:"CONTENTCRAFT-APP,AIFORCE-APP",
  APP_SECRET_CONTENTCRAFT_APP:secret,
  KV_MEMORY:{async get(k){return memory.get(k)??null;},async put(k,v){memory.set(k,v);}},
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
