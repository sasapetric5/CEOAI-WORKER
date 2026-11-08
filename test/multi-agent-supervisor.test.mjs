import test from "node:test";
import assert from "node:assert/strict";
import {createAgentRegistry} from "../src/agent/agent-registry.mjs";
import {BUILTIN_AGENTS} from "../src/agent/builtin-agents.mjs";
import {createMultiAgentSupervisor} from "../src/agent/multi-agent-supervisor.mjs";
import {createToolRegistry} from "../src/agent/tool-registry.mjs";
import {createSkillRegistry} from "../src/agent/skill-registry.mjs";
import {createAgentLoop} from "../src/agent/agent-loop.mjs";
import {createKVAgentSystem} from "../src/agent/agent-system.mjs";
import {BUILTIN_SKILLS} from "../src/agent/builtin-skills.mjs";
import {publishSkillCatalogToKV} from "../src/agent/skill-storage.mjs";
const emptyTools={get:()=>null};
test("five curated agents have valid role and skill references",()=>{
 const skills={get:id=>BUILTIN_SKILLS.find(s=>s.id===id)||null,search:()=>[]};
 const r=createAgentRegistry({agents:BUILTIN_AGENTS,skillRegistry:skills,toolRegistry:emptyTools});
 assert.equal(r.size,5);assert.equal(r.get("security_reviewer").allowedToolIds.length,0);
});
test("agent discovery ranks security and crawler specialists",()=>{
 const skills={get:id=>BUILTIN_SKILLS.find(s=>s.id===id)||null,search:task=>task.includes("crawler")?[{id:"cloudflare_queue_reliability",score:5}]:task.includes("HMAC")?[{id:"skill_two_axis_code_review",score:4}]:[]};
 const r=createAgentRegistry({agents:BUILTIN_AGENTS,skillRegistry:skills,toolRegistry:emptyTools});
 assert.equal(r.search("HMAC replay security audit")[0].id,"security_reviewer");
 assert.equal(r.search("crawler queue retry idempotency")[0].id,"crawler_reliability_engineer");
});
test("agent registry rejects unknown skills and unknown tools",()=>{
 assert.throws(()=>createAgentRegistry({agents:[{...BUILTIN_AGENTS[0],skillIds:["missing"]}],skillRegistry:{get:()=>null,search:()=>[]},toolRegistry:emptyTools}),/INVALID_AGENT_SKILLS/);
 assert.throws(()=>createAgentRegistry({agents:[{...BUILTIN_AGENTS[0],allowedToolIds:["missing"]}],skillRegistry:{get:id=>({id}),search:()=>[]},toolRegistry:emptyTools}),/INVALID_AGENT_CAPABILITIES/);
});
test("multi-agent supervisor requires explicit execution approval",async()=>{
 const supervisor=createMultiAgentSupervisor({agentRegistry:{search:()=>[],get:()=>null},skillRegistry:{get:()=>null,search:()=>[]},agentLoop:{run:async()=>({ok:true})}});
 const result=await supervisor.run({task:"review security",planAgent:async()=>({type:"final",output:"ok"})});
 assert.equal(result.code,"EXECUTION_NOT_APPROVED");
});
test("agents run sequentially under one shared tool-call budget",async()=>{
 let calls=0;
 const toolRegistry=createToolRegistry({enabled:true,tools:[{id:"lookup",description:"approved test lookup",inputSchema:{type:"object",properties:{term:{type:"string",maxLength:40}},required:["term"],additionalProperties:false},handler:async({term})=>{calls++;return {term};}}]});
 const skillRegistry=createSkillRegistry({toolRegistry,skills:[
  {id:"quality_task",version:"1.0.0",description:"Quality audit",tags:["audit"],keywords:["audit"],allowedToolIds:["lookup"],content:"Use lookup only when asked."},
  {id:"security_task",version:"1.0.0",description:"Security audit",tags:["audit"],keywords:["audit"],allowedToolIds:["lookup"],content:"Check security evidence."}
 ]});
 const agents=[
  {id:"quality_agent",version:"1.0.0",role:"Quality engineer",description:"Runs quality audit.",skillIds:["quality_task"],keywords:["audit","quality"],allowedToolIds:["lookup"]},
  {id:"security_agent",version:"1.0.0",role:"Security engineer",description:"Runs security audit.",skillIds:["security_task"],keywords:["audit","security"],allowedToolIds:["lookup"]}
 ];
 const registry=createAgentRegistry({agents,skillRegistry,toolRegistry});
 const loop=createAgentLoop({toolRegistry,skillRegistry,maxSteps:2,maxToolCalls:2});
 const supervisor=createMultiAgentSupervisor({agentRegistry:registry,skillRegistry,agentLoop:loop,maxAgents:2,maxToolCalls:2});
 const result=await supervisor.run({task:"audit quality and security",input:{record:"bounded"},allowedToolIds:["lookup"],allowToolExecution:true,maxToolCalls:1,planAgent:async({context})=>context.step===1?{type:"tool",toolId:"lookup",arguments:{term:"proof"}}:{type:"final",output:"verified"}});
 assert.equal(result.ok,true);assert.equal(result.partial,true);assert.equal(calls,1);
 assert.equal(result.results[0].ok,true);assert.equal(result.results[1].ok,false);assert.equal(result.results[1].code,"AGENT_SHARED_BUDGET_EXHAUSTED");
});
test("agent composition loads the KV skill library and exposes supervisor",async()=>{
 const values=new Map(),kv={async put(k,v){values.set(k,v);},async get(k){return values.get(k)??null;}};
 const toolRegistry=createToolRegistry({tools:[]});
 await publishSkillCatalogToKV({kv,skills:BUILTIN_SKILLS,toolRegistry,approvedSkillIds:BUILTIN_SKILLS.map(skill=>skill.id)});
 const system=await createKVAgentSystem({kv,toolRegistry,agentLoopFactory:({toolRegistry,skillRegistry})=>createAgentLoop({toolRegistry,skillRegistry}),mcpAuthorize:async context=>context?.valid===true});
 assert.equal(system.agents.size,5);assert.ok(system.multiAgentSupervisor);assert.ok(system.mcpResources);
 assert.equal((await system.mcpResources.handle({method:"resources/list"})).error.code,"ACCESS_DENIED");
 assert.equal((await system.mcpResources.handle({method:"resources/list",authContext:{valid:true}})).ok,true);
 assert.equal((await system.multiAgentSupervisor.prepare({task:"HMAC replay security audit"})).agents[0].id,"security_reviewer");
});

test("agent discovery never falls back to an unrelated assigned skill", () => {
 const skills = {get:id=>BUILTIN_SKILLS.find(skill=>skill.id===id)||null,search:()=>[]};
 const registry = createAgentRegistry({agents:BUILTIN_AGENTS,skillRegistry:skills,toolRegistry:emptyTools});
 assert.deepEqual(registry.search("HMAC replay security audit"),[]);
});
test("manual agent selection chooses only a task-relevant assigned skill", async () => {
 const skills = {
  get:id=>({id}),
  search:task=>task.toLowerCase().includes("security")
   ? [{id:"security_skill",score:9,matchedTerms:["security"]},{id:"generic_skill",score:2,matchedTerms:["review"]}]
   : []
 };
 const agents=[{id:"security_agent",version:"1.0.0",role:"Security engineer",description:"Reviews security controls.",skillIds:["generic_skill","security_skill"],keywords:["security"],allowedToolIds:[]}];
 const registry=createAgentRegistry({agents,skillRegistry:skills,toolRegistry:emptyTools});
 const supervisor=createMultiAgentSupervisor({agentRegistry:registry,skillRegistry:skills,agentLoop:{run:async()=>({ok:true})}});
 const relevant=await supervisor.prepare({task:"security review",agentIds:["security_agent"]});
 assert.equal(relevant.ok,true);
 assert.equal(relevant.agents[0].skillId,"security_skill");
 const unrelated=await supervisor.prepare({task:"unrelated gardening topic",agentIds:["security_agent"]});
 assert.equal(unrelated.code,"NO_RELEVANT_AGENT");
});

test("supervisor rejects getter-backed input without executing it or invoking the planner",async()=>{
 let getterCalls=0,plannerCalls=0;
 const skill={id:"safe_skill",version:"1.0.0",description:"Safe bounded test skill",allowedToolIds:[]};
 const agent={id:"safe_agent",role:"Safe test agent",description:"Bounded test agent",skillId:"safe_skill",allowedToolIds:[],score:1,matchedTerms:[]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},
  skillRegistry:{get:()=>skill,search:()=>[{id:"safe_skill",score:1,matchedTerms:[]}]},
  agentLoop:{run:async()=>({ok:true,output:"unexpected"})}
 });
 const input={};
 Object.defineProperty(input,"secret",{enumerable:true,get(){getterCalls++;return "should-not-run";}});
 const result=await supervisor.run({task:"safe test task",input,allowToolExecution:true,planAgent:async()=>{plannerCalls++;return {type:"final",output:"unexpected"};}});
 assert.equal(result.code,"INPUT_TOO_LARGE_OR_INVALID");
 assert.equal(getterCalls,0);
 assert.equal(plannerCalls,0);
});

test("supervisor accepts ordinary array values in sanitized input", async () => {
 const skill={id:"array_skill",version:"1.0.0",description:"Array fixture",allowedToolIds:[]};
 const agent={id:"array_agent",role:"Array test agent",description:"Accepts bounded arrays",skillId:"array_skill",allowedToolIds:[],score:1,matchedTerms:[]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},
  skillRegistry:{get:()=>skill,search:()=>[{id:"array_skill",score:1,matchedTerms:[]}]},
  agentLoop:{run:async({input})=>({ok:Array.isArray(input.input.items),output:"array accepted",steps:1,toolCalls:0})}
 });
 const result=await supervisor.run({
  task:"array input test",input:{items:["one","two",3]},allowToolExecution:true,
  planAgent:async()=>({type:"final",output:"unused"})
 });
 assert.equal(result.ok,true);
 assert.equal(result.results[0].ok,true);
});


test("supervisor returns a detached sanitized synthesis snapshot", async () => {
 const skill={id:"synthesis_skill",version:"1.0.0",description:"Synthesis fixture",allowedToolIds:[]};
 const agent={id:"synthesis_agent",role:"Synthesis agent",description:"Bounded synthesis test",skillId:"synthesis_skill",allowedToolIds:[],score:1,matchedTerms:[]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},
  skillRegistry:{get:()=>skill,search:()=>[{id:"synthesis_skill",score:1,matchedTerms:[]}]},
  agentLoop:{run:async()=>({ok:true,output:{answer:"verified"},steps:1,toolCalls:0})}
 });
 const original={answer:"combined"};
 const result=await supervisor.run({
  task:"synthesis boundary test",allowToolExecution:true,
  planAgent:async()=>({type:"final",output:"unused"}),
  synthesize:async()=>original
 });
 assert.equal(result.ok,true);
 assert.deepEqual(result.output,{answer:"combined"});
 assert.notEqual(result.output,original);
 original.answer="mutated after return";
 assert.equal(result.output.answer,"combined");
});

test("supervisor rejects accessor-backed synthesis output without invoking its getter", async () => {
 let getterCalls=0;
 const skill={id:"synthesis_safe",version:"1.0.0",description:"Synthesis fixture",allowedToolIds:[]};
 const agent={id:"synthesis_safe_agent",role:"Synthesis agent",description:"Bounded synthesis test",skillId:"synthesis_safe",allowedToolIds:[],score:1,matchedTerms:[]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},
  skillRegistry:{get:()=>skill,search:()=>[{id:"synthesis_safe",score:1,matchedTerms:[]}]},
  agentLoop:{run:async()=>({ok:true,output:"ok",steps:1,toolCalls:0})}
 });
 const unsafe={};
 Object.defineProperty(unsafe,"secret",{enumerable:true,get(){getterCalls++;return "nope";}});
 const result=await supervisor.run({
  task:"synthesis getter boundary",allowToolExecution:true,
  planAgent:async()=>({type:"final",output:"unused"}),
  synthesize:async()=>unsafe
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,"INVALID_SYNTHESIS_OUTPUT");
 assert.equal(getterCalls,0);
});


test("supervisor preserves a caller-supplied run ID for retry-stable tool keys", async () => {
 let receivedRunId;
 const skill={id:"stable_skill",version:"1.0.0",description:"Stable run fixture",allowedToolIds:[]};
 const agent={id:"stable_agent",role:"Stable agent",description:"Stable run test",skillId:"stable_skill",allowedToolIds:[],score:1,matchedTerms:[]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},
  skillRegistry:{get:()=>skill,search:()=>[{id:"stable_skill",score:1,matchedTerms:[]}]},
  agentLoop:{run:async args=>{receivedRunId=args.runId;return {ok:true,output:"ok",steps:1,toolCalls:0};}}
 });
 const result=await supervisor.run({
  task:"stable run test",runId:"client_task_123",allowToolExecution:true,
  planAgent:async()=>({type:"final",output:"unused"})
 });
 assert.equal(result.ok,true);
 assert.equal(receivedRunId,"client_task_123:stable_agent");
});

test("supervisor enforces four-layer capability grants at the exact tool call", async () => {
 const {createCapabilityRegistry}=await import("../src/agent/capability-registry.mjs");
 let calls=0;
 const toolRegistry=createToolRegistry({enabled:true,tools:[{
  id:"lookup",description:"Capability-protected lookup",
  inputSchema:{type:"object",properties:{term:{type:"string",maxLength:40}},required:["term"],additionalProperties:false},
  handler:async({term})=>{calls++;return {term};}
 }]});
 const skillRegistry=createSkillRegistry({toolRegistry,skills:[{
  id:"capability_skill",version:"1.0.0",description:"Capability fixture",allowedToolIds:["lookup"],content:"Use lookup."
 }]});
 const agents=[{id:"capability_agent",version:"1.0.0",role:"Capability agent",description:"Tests authority intersection.",skillIds:["capability_skill"],keywords:["capability"],allowedToolIds:["lookup"]}];
 const agentRegistry=createAgentRegistry({agents,skillRegistry,toolRegistry});
 const agentLoop=createAgentLoop({toolRegistry,skillRegistry,maxSteps:2,maxToolCalls:1});
 const grants=["app","caller","agent","skill"].map(subjectType=>({
  subjectType,subjectId:({app:"rankgeo",caller:"user_1",agent:"capability_agent",skill:"capability_skill"})[subjectType],
  appId:"rankgeo",capabilityId:"lookup",operations:["execute"],resourceScopes:["*"],maxCalls:1,expiresAt:0,approvalRequired:false
 }));
 const planAgent=async({context})=>context.step===1?{type:"tool",toolId:"lookup",arguments:{term:"proof"}}:{type:"final",output:"done"};
 const denied=createMultiAgentSupervisor({agentRegistry,skillRegistry,agentLoop,capabilityRegistry:createCapabilityRegistry({grants:grants.filter(g=>g.subjectType!=="caller")}),capabilityContext:{appId:"rankgeo",callerId:"user_1"},maxAgents:1,maxToolCalls:1});
 const deniedResult=await denied.run({task:"capability audit",allowedToolIds:["lookup"],allowToolExecution:true,capabilityContext:{appId:"contentcraft",callerId:"attacker"},planAgent});
 assert.equal(deniedResult.results[0].code,"CAPABILITY_NOT_GRANTED");
 assert.equal(calls,0);
 const allowed=createMultiAgentSupervisor({agentRegistry,skillRegistry,agentLoop,capabilityRegistry:createCapabilityRegistry({grants}),capabilityContext:{appId:"rankgeo",callerId:"user_1"},maxAgents:1,maxToolCalls:1});
 const allowedResult=await allowed.run({task:"capability audit",allowedToolIds:["lookup"],allowToolExecution:true,capabilityContext:{appId:"contentcraft",callerId:"attacker"},planAgent});
 assert.equal(allowedResult.ok,true);
 assert.equal(calls,1);
});

test("KV agent composition forwards capability registry into supervisor validation",async()=>{
 const values=new Map(),kv={async put(k,v){values.set(k,v);},async get(k){return values.get(k)??null;}};
 const toolRegistry=createToolRegistry({tools:[]});
 await publishSkillCatalogToKV({kv,skills:BUILTIN_SKILLS,toolRegistry,approvedSkillIds:BUILTIN_SKILLS.map(skill=>skill.id)});
 await assert.rejects(
  createKVAgentSystem({
   kv,toolRegistry,
   agentLoopFactory:({toolRegistry,skillRegistry})=>createAgentLoop({toolRegistry,skillRegistry}),
   capabilityRegistry:{}
  }),
  /INVALID_CAPABILITY_REGISTRY/
 );
});

test("production supervisor requires durable authority and ignores caller-supplied capability context",async()=>{
 const {createCapabilityRegistry}=await import("../src/agent/capability-registry.mjs");
 let calls=0;
 const toolRegistry=createToolRegistry({enabled:true,tools:[{
  id:"lookup",description:"Durable-only protected lookup",
  inputSchema:{type:"object",properties:{term:{type:"string",maxLength:40}},required:["term"],additionalProperties:false},
  handler:async()=>{calls++;return {ok:true};}
 }]});
 const skillRegistry=createSkillRegistry({toolRegistry,skills:[{id:"durable_skill",version:"1.0.0",description:"Durable policy test",allowedToolIds:["lookup"],content:"Use lookup."}]});
 const agent={id:"durable_agent",version:"1.0.0",role:"Durable test",description:"Tests durable fail-closed.",skillIds:["durable_skill"],keywords:["durable"],allowedToolIds:["lookup"]};
 const agentRegistry=createAgentRegistry({agents:[agent],skillRegistry,toolRegistry});
 const agentLoop=createAgentLoop({toolRegistry,skillRegistry,maxSteps:2,maxToolCalls:1});
 const grants=["app","caller","agent","skill"].map(subjectType=>({subjectType,subjectId:({app:"rankgeo",caller:"user_1",agent:"durable_agent",skill:"durable_skill"})[subjectType],appId:"rankgeo",capabilityId:"lookup",operations:["execute"],resourceScopes:[],maxCalls:1,expiresAt:0,approvalRequired:false}));
 const supervisor=createMultiAgentSupervisor({agentRegistry,skillRegistry,agentLoop,capabilityRegistry:createCapabilityRegistry({grants}),capabilityContext:{appId:"rankgeo",callerId:"user_1"},requireDurableAuthority:true,maxAgents:1,maxToolCalls:1});
 const result=await supervisor.run({task:"durable capability test",allowedToolIds:["lookup"],allowToolExecution:true,capabilityContext:{appId:"rankgeo",callerId:"user_1"},planAgent:async({context})=>context.step===1?{type:"tool",toolId:"lookup",arguments:{term:"x"}}:{type:"final",output:"unexpected"}});
 assert.equal(result.results[0].code,"CAPABILITY_AUTHORITY_REQUIRED");
 assert.equal(calls,0);
});

test("trusted approval provider receives exact canonical tool-argument digest before durable authorization",async()=>{
 let providerRequest=null,authorizationRequest=null;
 const skill={id:"approval_skill",version:"1.0.0",description:"Approval test skill",allowedToolIds:["lookup"]};
 const agent={id:"approval_agent",role:"Approval agent",description:"Approval flow fixture",skillId:"approval_skill",allowedToolIds:["lookup"],score:1,matchedTerms:[]};
 const supervisor=createMultiAgentSupervisor({
  agentRegistry:{search:()=>[agent],get:()=>agent},
  skillRegistry:{get:()=>skill,search:()=>[{id:skill.id,score:1,matchedTerms:[]}]},
  agentLoop:{run:async args=>{
   const authorization=await args.authorizeTool({toolId:"lookup",arguments:{query:"exact target"},runId:args.runId,step:1});
   return authorization?.ok?{ok:true,output:"approved",steps:1,toolCalls:1}:{ok:false,code:authorization?.code||"DENIED",steps:1,toolCalls:0};
  }},
  capabilityRegistry:{durable:true,resolve:()=>({ok:false,code:"LEGACY_PATH_FORBIDDEN"}),authorize:async request=>{authorizationRequest=request;return {ok:true,remaining:0};}},
  capabilityContext:{appId:"rankgeo",callerId:"app_rankgeo"},
  approvalProvider:async request=>{providerRequest=request;return {payload:{approvalId:"approval_server_123456"},signature:"server-signed-fixture"};},
  requireDurableAuthority:true,maxAgents:1,maxToolCalls:1
 });
 const result=await supervisor.run({task:"approval flow test",allowedToolIds:["lookup"],allowToolExecution:true,planAgent:async()=>({type:"final",output:"unused"})});
 assert.equal(result.ok,true);
 assert.equal(providerRequest.toolId,"lookup");
 assert.match(providerRequest.argumentsDigest,/^[a-f0-9]{64}$/);
 assert.equal(authorizationRequest.argumentsDigest,providerRequest.argumentsDigest);
 assert.equal(authorizationRequest.approval.payload.approvalId,"approval_server_123456");
 assert.equal(providerRequest.effectKey,authorizationRequest.effectKey);
 assert.equal(authorizationRequest.effectKey,providerRequest.runId+":1:lookup");
});
