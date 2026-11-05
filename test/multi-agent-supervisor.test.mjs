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
 await publishSkillCatalogToKV({kv,skills:BUILTIN_SKILLS,toolRegistry});
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
