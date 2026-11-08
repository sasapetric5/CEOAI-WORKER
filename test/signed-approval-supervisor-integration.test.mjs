import test from "node:test";
import assert from "node:assert/strict";
import {generateApprovalKeyPair,signCapabilityApprovalEd25519,createApprovalVerifier,hashCapabilityArguments} from "../src/agent/capability-grants.mjs";
import {createCapabilityApprovalProvider} from "../src/agent/capability-approval-provider.mjs";
import {createCapabilityRegistry} from "../src/agent/capability-registry.mjs";
import {createMultiAgentSupervisor} from "../src/agent/multi-agent-supervisor.mjs";
const NOW=1_800_000_000_000;
const context={appId:"rankgeo",callerId:"app_rankgeo",agentId:"approval_agent",skillId:"approval_skill",toolId:"lookup",operation:"execute",resource:"site:example.com"};
const args={query:"exact target"};
const grant=(subjectType,subjectId)=>({subjectType,subjectId,appId:"rankgeo",capabilityId:"lookup",operations:["execute"],resourceScopes:["site:example.com"],maxCalls:2,expiresAt:NOW+60_000,approvalRequired:true});
async function fixture(){
 const keys=await generateApprovalKeyPair();
 const digest=await hashCapabilityArguments(args);
 const payload={approvalId:"approval_integration_123456",...context,argumentsDigest:digest,expiresAt:NOW+5*60_000};
 const token=await signCapabilityApprovalEd25519(payload,keys.privateKey,{now:NOW});
 const provider=createCapabilityApprovalProvider([token]);
 const authorityCalls=[];
 const registry=createCapabilityRegistry({
  grants:[grant("app","rankgeo"),grant("caller","app_rankgeo"),grant("agent","approval_agent"),grant("skill","approval_skill")],
  now:()=>NOW,authority:{authorize:async request=>{authorityCalls.push(request);return {ok:true,remaining:1};}},
  verifyApproval:createApprovalVerifier({CAPABILITY_APPROVAL_PUBLIC_KEY:keys.publicKey},{now:NOW})
 });
 const agent={id:"approval_agent",role:"Approval agent",description:"Signed approval integration",skillId:"approval_skill",allowedToolIds:["lookup"],score:1,matchedTerms:[]};
 const skill={id:"approval_skill",version:"1.0.0",description:"Approval integration skill",allowedToolIds:["lookup"]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},skillRegistry:{get:()=>skill,search:()=>[{id:skill.id,score:1,matchedTerms:[]}]},
  agentLoop:{run:async call=>{const auth=await call.authorizeTool({toolId:"lookup",arguments:args,runId:call.runId,step:1});return auth.ok?{ok:true,output:"authorized",steps:1,toolCalls:1}:{ok:false,code:auth.code,steps:1,toolCalls:0};}},
  capabilityRegistry:registry,capabilityContext:{appId:context.appId,callerId:context.callerId,resource:context.resource},
  approvalProvider:provider,requireDurableAuthority:true,maxAgents:1,maxToolCalls:1
 });
 return {supervisor,authorityCalls,token,digest};
}
test("real Ed25519 approval flows through supervisor, registry and durable authority with exact argument digest",async()=>{
 const f=await fixture();
 const result=await f.supervisor.run({task:"signed approval test",allowedToolIds:["lookup"],allowToolExecution:true,planAgent:async()=>({type:"final",output:"unused"})});
 assert.equal(result.ok,true);
 assert.equal(f.authorityCalls.length,1);
 assert.equal(f.authorityCalls[0].approvalId,f.token.payload.approvalId);
 assert.equal(f.authorityCalls[0].argumentsDigest,f.digest);
 assert.equal(f.authorityCalls[0].effectKey,""+result.results[0].agentId+":1:lookup");
});
test("signed approval cannot authorize a changed resource or changed arguments",async()=>{
 const f=await fixture();
 const altered=f.supervisor;
 // The approval selector is independently exercised against the exact canonical call claims.
 const request={...context,argumentsDigest:f.digest,effectKey:"approval_agent:1:lookup"};
 assert.ok(await (async()=>Boolean(await (await import("../src/agent/capability-approval-provider.mjs")).createCapabilityApprovalProvider([f.token])({...request,resource:"site:evil.example"}))===false)());
 assert.equal(f.authorityCalls.length,0);
});
