import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityAuthorityDO } from "../src/durable-objects/capability-authority-do.mjs";
import { createCloudflareCapabilityAuthority } from "../src/agent/cloudflare-capability-authority.mjs";
function harness({seed={},now=()=>Date.now()}={}){
 const data=new Map(Object.entries(seed));let chain=Promise.resolve();
 const storage={
  get:async k=>data.get(k),
  put:async(k,v)=>{data.set(k,structuredClone(v));},
  transaction:async fn=>{let release;const previous=chain;chain=new Promise(r=>release=r);await previous;try{return await fn({get:async k=>data.get(k),put:async(k,v)=>{data.set(k,structuredClone(v));}});}finally{release();}}
 };
 const object=new CapabilityAuthorityDO({storage},{now});
 const namespace={idFromName:name=>name,get:id=>({fetch:(url,init)=>object.fetch(new Request(url,init))})};
 return {authority:createCloudflareCapabilityAuthority(namespace),data};
}
const request=(extra={})=>({appId:"rankgeo",callerId:"caller_1",agentId:"seo_agent",skillId:"seo_audit",toolId:"web_search",operation:"execute",resource:"site:example.com",maxCalls:1,approvalId:null,...extra});
test("durable capability quota admits only one of two concurrent calls",async()=>{
 const {authority}=harness();
 const results=await Promise.all([authority.authorize(request()),authority.authorize(request())]);
 assert.equal(results.filter(x=>x.ok).length,1);
 assert.equal(results.filter(x=>x.code==="CAPABILITY_QUOTA_EXCEEDED").length,1);
});
test("one-time approval is consumed once across concurrent requests",async()=>{
 const {authority}=harness();const req=request({maxCalls:5,approvalId:"approval_123456789012"});
 const results=await Promise.all([authority.authorize(req),authority.authorize(req)]);
 assert.equal(results.filter(x=>x.ok).length,1);
 assert.equal(results.filter(x=>x.code==="CAPABILITY_APPROVAL_REQUIRED").length,1);
});
test("quota and approval state are isolated by app and caller",async()=>{
 const {authority}=harness();
 assert.equal((await authority.authorize(request())).ok,true);
 assert.equal((await authority.authorize(request({appId:"contentcraft"}))).ok,true);
 assert.equal((await authority.authorize(request({callerId:"caller_2"}))).ok,true);
});
test("authority fails closed when the Durable Object binding is missing",()=>{
 assert.throws(()=>createCloudflareCapabilityAuthority(null),/CAPABILITY_AUTHORITY_BINDING_REQUIRED/);
});
test("malformed authority requests are rejected before network access",async()=>{
 const {authority}=harness();
 assert.equal((await authority.authorize(request({appId:"../rankgeo"}))).code,"INVALID_AUTHORITY_REQUEST");
});

test("changing resource cannot reset the shared capability quota",async()=>{
 const {authority}=harness();
 assert.equal((await authority.authorize(request({resource:"site:one.example"}))).ok,true);
 assert.equal((await authority.authorize(request({resource:"site:two.example"}))).code,"CAPABILITY_QUOTA_EXCEEDED");
});

 
test("same stable effect key replays its durable authorization receipt without consuming quota twice",async()=>{
 const {authority}=harness();
 const req=request({maxCalls:1,approvalId:"approval_effect_123456",argumentsDigest:"a".repeat(64),effectKey:"run-1:agent:1:web_search"});
 const first=await authority.authorize(req);
 const second=await authority.authorize(req);
 assert.equal(first.ok,true);
 assert.equal(second.ok,true);
 assert.equal(second.replayed,true);
 assert.equal(second.remaining,0);
});

test("stable effect key cannot be rebound to changed arguments or approval claims",async()=>{
 const {authority}=harness();
 const req=request({maxCalls:2,argumentsDigest:"a".repeat(64),effectKey:"run-2:agent:1:web_search"});
 assert.equal((await authority.authorize(req)).ok,true);
 const changed=await authority.authorize({...req,argumentsDigest:"b".repeat(64)});
 assert.equal(changed.code,"IDEMPOTENCY_KEY_CONFLICT");
});


test("legacy lifetime usage migrates conservatively into the first UTC daily bucket",async()=>{
 const quotaKey=["rankgeo","caller_1","seo_agent","seo_audit","web_search","execute"].join("|");
 const {authority,data}=harness({seed:{["usage:"+quotaKey]:1},now:()=>Date.parse("2026-11-09T12:00:00.000Z")});
 const first=await authority.authorize(request({maxCalls:2}));
 assert.equal(first.ok,true);
 assert.equal(first.remaining,0);
 assert.equal(data.get("usage:"+quotaKey+":2026-11-09"),2);
 assert.equal(data.get("usage-migration:v1:"+quotaKey).firstDailyBucket,"2026-11-09");
 assert.equal((await authority.authorize(request({maxCalls:2}))).code,"CAPABILITY_QUOTA_EXCEEDED");
});

test("UTC daily quota resets once at midnight without re-importing legacy usage",async()=>{
 const quotaKey=["rankgeo","caller_1","seo_agent","seo_audit","web_search","execute"].join("|");
 let now=Date.parse("2026-11-09T23:59:00.000Z");
 const {authority,data}=harness({seed:{["usage:"+quotaKey]:1},now:()=>now});
 assert.equal((await authority.authorize(request({maxCalls:2}))).ok,true);
 now=Date.parse("2026-11-10T00:01:00.000Z");
 const nextDay=await authority.authorize(request({maxCalls:2}));
 assert.equal(nextDay.ok,true);
 assert.equal(nextDay.remaining,1);
 assert.equal(data.get("usage:"+quotaKey+":2026-11-10"),1);
 assert.equal(data.get("usage:"+quotaKey+":2026-11-09"),2);
});
