import test from "node:test";
import assert from "node:assert/strict";
import {createAgentRegistry} from "../src/agent/agent-registry.mjs";
import {createMultiAgentSupervisor} from "../src/agent/multi-agent-supervisor.mjs";
import {createToolRegistry} from "../src/agent/tool-registry.mjs";
import {createSkillRegistry} from "../src/agent/skill-registry.mjs";
import {createAgentLoop} from "../src/agent/agent-loop.mjs";

test("multi-agent reports shared budget consumed by a failed tool call", async () => {
  const baseTools = createToolRegistry({enabled:true,tools:[{
    id:"lookup",
    description:"Approved test lookup.",
    inputSchema:{type:"object",properties:{term:{type:"string",maxLength:40}},required:["term"],additionalProperties:false},
    handler:async()=>({value:"unused"})
  }]});
  const toolRegistry = {...baseTools,execute:async()=>({ok:false,code:"TOOL_TIMEOUT"})};
  const skillRegistry = createSkillRegistry({toolRegistry:baseTools,skills:[
    {id:"quality_task",version:"1.0.0",description:"Quality audit",tags:["audit"],keywords:["audit","quality"],allowedToolIds:["lookup"],content:"Use lookup only for evidence."},
    {id:"security_task",version:"1.0.0",description:"Security audit",tags:["audit"],keywords:["audit","security"],allowedToolIds:["lookup"],content:"Use lookup only for evidence."}
  ]});
  const agents = [
    {id:"quality_agent",version:"1.0.0",role:"Quality engineer",description:"Runs quality audit.",skillIds:["quality_task"],keywords:["audit","quality"],allowedToolIds:["lookup"]},
    {id:"security_agent",version:"1.0.0",role:"Security engineer",description:"Runs security audit.",skillIds:["security_task"],keywords:["audit","security"],allowedToolIds:["lookup"]}
  ];
  const agentRegistry = createAgentRegistry({agents,skillRegistry,toolRegistry:baseTools});
  const agentLoop = createAgentLoop({toolRegistry,skillRegistry,maxSteps:2,maxToolCalls:2});
  const supervisor = createMultiAgentSupervisor({agentRegistry,skillRegistry,agentLoop,maxAgents:2,maxToolCalls:2});
  const result = await supervisor.run({
    task:"audit quality and security",
    input:{record:"bounded"},
    allowedToolIds:["lookup"],
    allowToolExecution:true,
    maxToolCalls:1,
    planAgent:async()=>({type:"tool",toolId:"lookup",arguments:{term:"proof"}})
  });
  assert.equal(result.ok,false);
  assert.equal(result.results[0].code,"TOOL_TIMEOUT");
  assert.equal(result.results[0].budgetUsed,1);
  assert.equal(result.results[1].code,"AGENT_SHARED_BUDGET_EXHAUSTED");
  assert.equal(result.budgetUsed,1);
});
