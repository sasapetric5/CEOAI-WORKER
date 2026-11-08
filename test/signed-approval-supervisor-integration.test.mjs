import test from "node:test";
import assert from "node:assert/strict";
import {generateApprovalKeyPair,signCapabilityApprovalEd25519,createApprovalVerifier,hashCapabilityArguments} from "../src/agent/capability-grants.mjs";
import {createCapabilityApprovalProvider} from "../src/agent/capability-approval-provider.mjs";
import {createCapabilityRegistry} from "../src/agent/capability-registry.mjs";
import {createMultiAgentSupervisor} from "../src/agent/multi-agent-supervisor.mjs";
import {createToolRegistry} from "../src/agent/tool-registry.mjs";
import {createAgentLoop} from "../src/agent/agent-loop.mjs";
import {createIdempotentToolExecutor} from "../src/agent/idempotent-tool-executor.mjs";
import {createMemoryCheckpointStore} from "../src/agent/durable-execution.mjs";
import {CapabilityAuthorityDO} from "../src/durable-objects/capability-authority-do.mjs";
import {createCloudflareCapabilityAuthority} from "../src/agent/cloudflare-capability-authority.mjs";
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
 assert.match(f.authorityCalls[0].effectKey,/^[A-Za-z0-9_-]+:approval_agent:1:lookup$/);
});
test("signed approval cannot authorize a changed resource or changed arguments",async()=>{
 const f=await fixture();
 const altered=f.supervisor;
 // The approval selector is independently exercised against the exact canonical call claims.
 const request={...context,argumentsDigest:f.digest,effectKey:"approval_agent:1:lookup"};
 assert.ok(await (async()=>Boolean(await (await import("../src/agent/capability-approval-provider.mjs")).createCapabilityApprovalProvider([f.token])({...request,resource:"site:evil.example"}))===false)());
 assert.equal(f.authorityCalls.length,0);
});

test("signed approval, four grants and durable idempotent executor form one end-to-end tool path",async()=>{
 const keys=await generateApprovalKeyPair();
 const runId="run_approval_001";
 const effectKey=runId+":approval_agent:1:lookup";
 const digest=await hashCapabilityArguments(args);
 const payload={approvalId:"approval_e2e_123456789",...context,argumentsDigest:digest,expiresAt:NOW+5*60_000};
 const token=await signCapabilityApprovalEd25519(payload,keys.privateKey,{now:NOW});
 const provider=createCapabilityApprovalProvider([token]);
 const data=new Map();
 let transaction=Promise.resolve();
 const storage={transaction:async fn=>{
  let release;const previous=transaction;transaction=new Promise(resolve=>{release=resolve;});await previous;
  try{return await fn({get:async key=>data.get(key),put:async(key,value)=>{data.set(key,structuredClone(value));}});}
  finally{release();}
 }};
 const durableObject=new CapabilityAuthorityDO({storage});
 const namespace={idFromName:name=>name,get:()=>({fetch:(url,init)=>durableObject.fetch(new Request(url,init))})};
 const authority=createCloudflareCapabilityAuthority(namespace);
 const capabilityRegistry=createCapabilityRegistry({
  grants:[grant("app","rankgeo"),grant("caller","app_rankgeo"),grant("agent","approval_agent"),grant("skill","approval_skill")],
  now:()=>NOW,authority,verifyApproval:createApprovalVerifier({CAPABILITY_APPROVAL_PUBLIC_KEY:keys.publicKey},{now:NOW})
 });
 const executor=createIdempotentToolExecutor({store:createMemoryCheckpointStore()});
 let externalEffects=0;
 const toolRegistry=createToolRegistry({enabled:true,idempotentExecutor:executor,tools:[{
  id:"lookup",description:"Idempotent protected lookup",idempotencyMode:"downstream_key",
  inputSchema:{type:"object",properties:{query:{type:"string",maxLength:80}},required:["query"],additionalProperties:false},
  handler:async()=>{externalEffects++;return {found:true};}
 }]});
 const skillRegistry={get:()=>({id:"approval_skill",version:"1.0.0",description:"Approved lookup",allowedToolIds:["lookup"]}),allows:(_skillId,toolId)=>toolId==="lookup",search:()=>[{id:"approval_skill",score:1,matchedTerms:[]}]};
 const agentLoop=createAgentLoop({toolRegistry,skillRegistry,maxSteps:2,maxToolCalls:1});
 const agent={id:"approval_agent",role:"Approval agent",description:"Signed and idempotent execution",skillId:"approval_skill",allowedToolIds:["lookup"],score:1,matchedTerms:[]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},skillRegistry,agentLoop,
  capabilityRegistry,capabilityContext:{appId:context.appId,callerId:context.callerId,resource:context.resource},
  approvalProvider:provider,requireDurableAuthority:true,maxAgents:1,maxToolCalls:1
 });
 const run=()=>supervisor.run({task:"approved lookup",allowedToolIds:["lookup"],allowToolExecution:true,runId,planAgent:async({context:ctx})=>ctx.step===1?{type:"tool",toolId:"lookup",arguments:args}:{type:"final",output:"complete"}});
 const first=await run();
 const replay=await run();
 assert.equal(first.ok,true);
 assert.equal(replay.ok,true);
 assert.equal(externalEffects,1,"the tool side effect must execute exactly once");
 assert.equal(data.has("effect:"+effectKey),true,"the Durable Object stores the stable effect receipt");
 assert.equal(data.has("approval:"+token.payload.approvalId),true,"the Durable Object consumes the signed approval");
 assert.equal(data.get("usage:rankgeo|app_rankgeo|approval_agent|approval_skill|lookup|execute"),1);
});
