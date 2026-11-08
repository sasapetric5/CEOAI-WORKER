import test from "node:test";
import assert from "node:assert/strict";
import {signCapabilityGrant,verifyCapabilityGrant,loadVerifiedCapabilityGrants,signCapabilityApproval,verifyCapabilityApproval,hashCapabilityArguments} from "../src/agent/capability-grants.mjs";
const secret="server-only-capability-signing-key-32-bytes-min";
const grant={subjectType:"app",subjectId:"rankgeo",appId:"rankgeo",capabilityId:"web_search",operations:["execute"],resourceScopes:["site:example.com"],maxCalls:3,expiresAt:2000000,approvalRequired:true};
test("server signs and verifies a bounded capability grant",async()=>{
 const token=await signCapabilityGrant(grant,secret,{now:1000000});
 const result=await verifyCapabilityGrant(token,secret,{now:1000000});
 assert.equal(result.ok,true);assert.deepEqual(result.grant,grant);
});
test("grant signature rejects payload tampering and wrong server key",async()=>{
 const token=await signCapabilityGrant(grant,secret,{now:1000000});
 assert.equal((await verifyCapabilityGrant({...token,payload:{...token.payload,maxCalls:999}},secret,{now:1000000})).code,"CAPABILITY_GRANT_SIGNATURE_INVALID");
 assert.equal((await verifyCapabilityGrant(token,"different-server-key-32-bytes-long",{now:1000000})).code,"CAPABILITY_GRANT_SIGNATURE_INVALID");
});
test("expired, overlong and malformed grants are rejected",async()=>{
 assert.equal((await verifyCapabilityGrant(await signCapabilityGrant(grant,secret,{now:1000000}),secret,{now:2000000})).code,"INVALID_CAPABILITY_GRANT");
 await assert.rejects(signCapabilityGrant({...grant,expiresAt:1000000+32*24*60*60*1000},secret,{now:1000000}),/INVALID_CAPABILITY_GRANT/);
 await assert.rejects(signCapabilityGrant({...grant,subjectId:"../rankgeo"},secret,{now:1000000}),/INVALID_CAPABILITY_GRANT/);
});
test("grant loader fails closed without dedicated server signing secret",async()=>{
 const token=await signCapabilityGrant(grant,secret,{now:1000000});
 await assert.rejects(loadVerifiedCapabilityGrants({CAPABILITY_GRANTS_JSON:JSON.stringify([token])},{now:1000000}),/CAPABILITY_GRANT_SIGNING_KEY_REQUIRED/);
 assert.deepEqual(await loadVerifiedCapabilityGrants({CAPABILITY_GRANTS_JSON:""},{now:1000000}),[]);
});
test("grant loader rejects any invalid token in the configured set",async()=>{
 const token=await signCapabilityGrant(grant,secret,{now:1000000});
 await assert.rejects(loadVerifiedCapabilityGrants({CAPABILITY_GRANT_SIGNING_KEY:secret,CAPABILITY_GRANTS_JSON:JSON.stringify([token,{...token,signature:"A".repeat(43)}])},{now:1000000}));
});
const approval={approvalId:"approval_123456789012",appId:"rankgeo",callerId:"caller_1",agentId:"seo_agent",skillId:"seo_audit",toolId:"web_search",operation:"execute",resource:"site:example.com",argumentsDigest:"a".repeat(64),effectKey:"run-1:seo_agent:1:web_search",expiresAt:1005000};
test("server-signed approval is bound to every execution dimension",async()=>{
 const token=await signCapabilityApproval(approval,secret,{now:1000000});
 const expected={appId:"rankgeo",callerId:"caller_1",agentId:"seo_agent",skillId:"seo_audit",toolId:"web_search",operation:"execute",resource:"site:example.com",argumentsDigest:"a".repeat(64),effectKey:"run-1:seo_agent:1:web_search"};
 assert.equal(await verifyCapabilityApproval(token,secret,expected,{now:1000000}),true);
 assert.equal(await verifyCapabilityApproval(token,secret,{...expected,callerId:"attacker"},{now:1000000}),false);
 assert.equal(await verifyCapabilityApproval(token,secret,{...expected,resource:"site:evil.example"},{now:1000000}),false);
 assert.equal(await verifyCapabilityApproval(token,secret,{...expected,argumentsDigest:"b".repeat(64)},{now:1000000}),false);
 assert.equal(await verifyCapabilityApproval(token,secret,expected,{now:1005000}),false);
});

test("tool argument digest is canonical, stable and rejects unsafe structures",async()=>{
 const first=await hashCapabilityArguments({z:2,a:{b:true,c:["x",1]}});
 const reordered=await hashCapabilityArguments({a:{c:["x",1],b:true},z:2});
 const changed=await hashCapabilityArguments({a:{c:["x",2],b:true},z:2});
 assert.equal(first,reordered);
 assert.notEqual(first,changed);
 const cyclic={};cyclic.self=cyclic;
 await assert.rejects(hashCapabilityArguments(cyclic),/CAPABILITY_ARGUMENTS_TOO_DEEP|INVALID_CAPABILITY_ARGUMENTS/);
});
