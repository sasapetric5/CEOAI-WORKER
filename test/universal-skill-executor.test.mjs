import test from "node:test";
import assert from "node:assert/strict";
import {createMultiAgentSupervisor} from "../src/agent/multi-agent-supervisor.mjs";

function fixture({skills,agents=[]}={}){
 const registry={
  get:id=>skills.find(skill=>skill.id===id)||null,
  search:(task,{limit=3}={})=>skills.filter(skill=>task.toLowerCase().split(/\s+/).some(word=>(skill.keywords||[]).includes(word)||skill.id.includes(word))).slice(0,limit).map((skill,index)=>({...skill,score:10-index,matchedTerms:[]})),
 };
 const agentRegistry={get:id=>agents.find(agent=>agent.id===id)||null,search:()=>agents};
 const calls=[];
 const agentLoop={run:async args=>{calls.push(args);return {ok:true,output:"completed",steps:1,toolCalls:0};}};
 return {supervisor:createMultiAgentSupervisor({agentRegistry,skillRegistry:registry,agentLoop}),calls};
}

test("universal executor discovers approved registry skills without a specialist profile",async()=>{
 const {supervisor}=fixture({skills:[
  {id:"seo_audit",version:"1.0.0",description:"SEO audit",allowedToolIds:[],keywords:["seo"],tags:["seo"]},
  {id:"earn_proposal",version:"1.0.0",description:"EARN proposal",allowedToolIds:[],keywords:["earn"],tags:["earn"]},
 ]});
 const result=await supervisor.prepare({task:"seo audit"});
 assert.equal(result.ok,true);
 assert.equal(result.agents[0].id,"universal_skill_executor");
 assert.equal(result.agents[0].skillId,"seo_audit");
 assert.equal(result.agents[0].universal,true);
});

test("universal executor remains fail-closed without explicit execution approval",async()=>{
 const {supervisor,calls}=fixture({skills:[{id:"seo_audit",version:"1.0.0",description:"SEO audit",allowedToolIds:[],keywords:["seo"]}]});
 const result=await supervisor.run({task:"seo audit",planAgent:async()=>({type:"final",output:"done"})});
 assert.equal(result.code,"EXECUTION_NOT_APPROVED");
 assert.equal(calls.length,0);
});

test("universal executor grants no tools unless caller, agent and skill policies intersect",async()=>{
 const {supervisor,calls}=fixture({skills:[{id:"seo_audit",version:"1.0.0",description:"SEO audit",allowedToolIds:["lookup"],keywords:["seo"]}]});
 const result=await supervisor.run({task:"seo audit",allowToolExecution:true,allowedToolIds:[],planAgent:async()=>({type:"final",output:"done"})});
 assert.equal(result.ok,true);
 assert.deepEqual(calls[0].allowedToolIds,[]);
});

test("explicit specialist/app allowlist cannot fall through to universal skills",async()=>{
 const {supervisor}=fixture({skills:[{id:"seo_audit",version:"1.0.0",description:"SEO audit",allowedToolIds:[],keywords:["seo"]}]});
 const result=await supervisor.prepare({task:"seo audit",agentIds:["app_scoped_agent"]});
 assert.equal(result.code,"AGENT_NOT_FOUND");
});
