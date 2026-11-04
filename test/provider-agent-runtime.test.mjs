import test from "node:test";
import assert from "node:assert/strict";
import {createProviderAgentRuntime} from "../src/agent/provider-agent-runtime.mjs";
const system={multiAgentSupervisor:{async run(args){return {ok:true,output:await args.planAgent({agent:{id:"qa_agent",role:"QA",description:"Checks tests"},skill:{id:"qa_skill",version:"1.0.0",description:"test"},context:{step:1,input:{},availableToolIds:[],skillInstructions:"QA notes"},task:args.task,input:args.input}),synthesis:args.synthesize?await args.synthesize({task:args.task,results:[{agentId:"qa_agent",output:"ok"}]}):null,approved:args.allowToolExecution};}}};
test("provider runtime refuses execution unless explicitly approved",async()=>{
 const runtime=createProviderAgentRuntime({system,generateText:async()=>({ok:true,text:'{"type":"final","output":"ok"}'})});
 assert.equal((await runtime.runTask({task:"test"})).code,"EXECUTION_NOT_APPROVED");
});
test("provider runtime wires the planner and final synthesis",async()=>{
 let calls=0;
 const runtime=createProviderAgentRuntime({system,maxModelCalls:2,generateText:async(_messages,_intent,kind)=>{calls++;return {ok:true,text:kind==="agent_synthesis"?'{"output":"combined"}':'{"type":"final","output":"verified"}'};}});
 const result=await runtime.runTask({task:"verify test suite",allowToolExecution:true,allowedToolIds:[],synthesize:true});
 assert.equal(result.ok,true);assert.deepEqual(result.output,{type:"final",output:"verified"});assert.equal(result.synthesis,"combined");assert.equal(result.modelUsage.used,2);assert.equal(calls,2);
});
test("provider runtime supports no-synthesis mode and bounded agent count",async()=>{
 const runtime=createProviderAgentRuntime({system,generateText:async()=>({ok:true,text:'{"type":"final","output":"done"}'})});
 const result=await runtime.runTask({task:"review",allowToolExecution:true,synthesize:false,limit:1});
 assert.equal(result.ok,true);assert.equal(result.synthesis,null);
});
