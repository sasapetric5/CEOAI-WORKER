import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityAuthorityDO } from "../src/durable-objects/capability-authority-do.mjs";
import { createCloudflareCapabilityAuthority } from "../src/agent/cloudflare-capability-authority.mjs";
function harness(){
 const data=new Map();let chain=Promise.resolve();
 const storage={
  get:async k=>data.get(k),
  put:async(k,v)=>{data.set(k,structuredClone(v));},
  transaction:async fn=>{let release;const previous=chain;chain=new Promise(r=>release=r);await previous;try{return await fn({get:async k=>data.get(k),put:async(k,v)=>{data.set(k,structuredClone(v));}});}finally{release();}}
 };
 const object=new CapabilityAuthorityDO({storage});
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
