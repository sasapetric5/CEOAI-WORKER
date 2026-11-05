import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry } from "../src/agent/capability-registry.mjs";
const grant=(subjectType,subjectId,extra={})=>({subjectType,subjectId,appId:"rankgeo",capabilityId:"web_search",operations:["execute"],resourceScopes:[],maxCalls:3,expiresAt:0,approvalRequired:false,...extra});
const base=()=>[
 grant("app","rankgeo"),grant("caller","user_1"),grant("agent","seo_agent"),grant("skill","seo_audit")
];
const request={appId:"rankgeo",callerId:"user_1",agentId:"seo_agent",skillId:"seo_audit",toolId:"web_search"};
test("all four registry layers must grant the capability",()=>{
 const r=createCapabilityRegistry({grants:base()});
 assert.equal(r.resolve(request).ok,true);
 for(let i=0;i<4;i++){const g=base();g.splice(i,1);assert.equal(createCapabilityRegistry({grants:g}).resolve(request).code,"CAPABILITY_NOT_GRANTED");}
});
test("deny by default and reject malformed identities",()=>{
 assert.equal(createCapabilityRegistry().resolve(request).code,"CAPABILITY_NOT_GRANTED");
 assert.equal(createCapabilityRegistry().resolve({...request,appId:"../rankgeo"}).code,"INVALID_CAPABILITY_REQUEST");
});
test("agent and skill declarations cannot elevate authority",()=>{
 const r=createCapabilityRegistry({grants:base().filter(g=>g.subjectType!=="skill")});
 assert.equal(r.resolve({...request,toolId:"other_tool"}).code,"CAPABILITY_NOT_GRANTED");
});
test("approval-required grants need a matching approval bound to all identities",()=>{
 const grants=base().map(g=>({...g,approvalRequired:g.subjectType==="skill"}));
 const r=createCapabilityRegistry({grants});
 assert.equal(r.resolve(request).code,"CAPABILITY_APPROVAL_REQUIRED");
 assert.equal(r.resolve({...request,approval:{approved:true,appId:"rankgeo",callerId:"user_1",agentId:"seo_agent",skillId:"seo_audit",toolId:"web_search",operation:"execute"}}).ok,true);
});
test("approval cannot be replayed across another app or tool",()=>{
 const grants=base().map(g=>({...g,approvalRequired:true}));
 const r=createCapabilityRegistry({grants});
 const approval={approved:true,appId:"rankgeo",callerId:"user_1",agentId:"seo_agent",skillId:"seo_audit",toolId:"web_search",operation:"execute"};
 assert.equal(r.resolve({...request,toolId:"other_tool",approval}).code,"CAPABILITY_NOT_GRANTED");
 assert.equal(r.resolve({...request,appId:"contentcraft",approval}).code,"CAPABILITY_NOT_GRANTED");
});
test("expired grants are denied",()=>{
 let clock=1000;
 const r=createCapabilityRegistry({grants:base().map(g=>({...g,expiresAt:2000})),now:()=>clock});
 assert.equal(r.resolve(request).ok,true);clock=2000;
 assert.equal(r.resolve(request).code,"CAPABILITY_NOT_GRANTED");
});
test("quota is the strictest limit across all four layers",()=>{
 const grants=base().map((g,i)=>({...g,maxCalls:i===2?1:3}));
 const r=createCapabilityRegistry({grants});
 assert.equal(r.resolve(request).ok,true);
 assert.equal(r.resolve(request).code,"CAPABILITY_QUOTA_EXCEEDED");
});
test("resource scopes restrict access",()=>{
 const grants=base().map(g=>({...g,resourceScopes:["site:example.com"]}));
 const r=createCapabilityRegistry({grants});
 assert.equal(r.resolve({...request,resource:"site:example.com"}).ok,true);
 assert.equal(r.resolve({...request,resource:"site:evil.com"}).code,"CAPABILITY_NOT_GRANTED");
});
test("resolveTools returns only the intersection and reports denials",()=>{
 const r=createCapabilityRegistry({grants:base()});
 const out=r.resolveTools({...request,declaredToolIds:["web_search","browser_write"]});
 assert.deepEqual(out.allowedToolIds,["web_search"]);
 assert.deepEqual(out.denied,[{toolId:"browser_write",code:"CAPABILITY_NOT_GRANTED"}]);
});
test("duplicate grants and invalid operation contracts are rejected",()=>{
 assert.throws(()=>createCapabilityRegistry({grants:[...base(),base()[0]]}),/DUPLICATE_CAPABILITY_GRANT/);
 assert.throws(()=>createCapabilityRegistry({grants:[grant("app","rankgeo",{operations:[]})]}),/INVALID_CAPABILITY_OPERATIONS/);
});
test("audit receives grants and denials without secrets",()=>{
 const events=[];const r=createCapabilityRegistry({grants:base(),audit:{record:e=>events.push(e)}});
 r.resolve(request);r.resolve({...request,toolId:"not_allowed"});
 assert.deepEqual(events.map(e=>e.type),["capability_granted","capability_denied"]);
 assert.equal(JSON.stringify(events).includes("token"),false);
});
