import test from "node:test";
import assert from "node:assert/strict";
import {createCapabilityApprovalProvider} from "../src/agent/capability-approval-provider.mjs";
const payload={approvalId:"approval_123456789012",appId:"rankgeo",callerId:"caller_1",agentId:"seo_agent",skillId:"seo_audit",toolId:"web_search",operation:"execute",resource:"site:example.com",argumentsDigest:"a".repeat(64),effectKey:"run-1:seo_agent:1:web_search",expiresAt:2000000};
const token={version:2,payload,signature:"A".repeat(86)};
test("approval provider selects only an exact match across every signed call claim",async()=>{
 const provider=createCapabilityApprovalProvider([token]);
 assert.deepEqual(await provider({...payload,effectKey:"run:1:web_search"}),token);
 for(const key of ["appId","callerId","agentId","skillId","toolId","operation","resource","argumentsDigest","effectKey"]){
  assert.equal(await provider({...payload,[key]:key==="argumentsDigest"?"b".repeat(64):"different"}),null,key);
 }
});
test("approval provider rejects malformed, legacy, unknown-field and duplicate tokens",()=>{
 assert.throws(()=>createCapabilityApprovalProvider([{...token,version:1}]),/INVALID_APPROVAL_TOKENS/);
 assert.throws(()=>createCapabilityApprovalProvider([{...token,payload:{...payload,unexpected:true}}]),/INVALID_APPROVAL_TOKENS/);
 assert.throws(()=>createCapabilityApprovalProvider([token,token]),/DUPLICATE_APPROVAL_ID/);
 assert.throws(()=>createCapabilityApprovalProvider(Array(9).fill(token)),/INVALID_APPROVAL_TOKENS/);
});
test("approval provider returns no token for an unmatched tool call",async()=>{
 const provider=createCapabilityApprovalProvider([token]);
 assert.equal(await provider({...payload,toolId:"publish"}),null);
});
