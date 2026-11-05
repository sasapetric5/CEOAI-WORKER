import test from "node:test";
import assert from "node:assert/strict";
import {createToolRegistry,createToolSession} from "../src/agent/tool-registry.mjs";
import {createAgentLoop,createAgentBudget} from "../src/agent/agent-loop.mjs";

const schema={type:"object",properties:{
 value:{type:"string",maxLength:5},
 count:{type:"integer",minimum:0,maximum:2},
 flag:{type:"boolean"}
},required:["value"],additionalProperties:false};
function makeToolRegistry({enabled=true,handler=async input=>({echo:input}),limits={}}={}) {
 return createToolRegistry({enabled,limits,tools:[{id:"safe_read",description:"Bounded security test tool",inputSchema:schema,handler}]});
}
function contextFor(session,allowedToolIds=["safe_read"]) {
 return {allowToolExecution:true,allowedToolIds,session};
}
async function execute(registry,{context,input={value:"ok"},id="safe_read"}={}) {
 return registry.execute(id,input,context);
}

const toolCases=[
 ["tools are disabled by default",async()=>{
  const r=makeToolRegistry({enabled:false}),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s)})).code,"TOOLS_DISABLED");
 }],
 ["execution requires explicit approval",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:{...contextFor(s),allowToolExecution:false}})).code,"EXECUTION_NOT_APPROVED");
 }],
 ["missing capability grant is denied",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:{allowToolExecution:true,session:s}})).code,"TOOL_CAPABILITY_DENIED");
 }],
 ["unknown tool is denied",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{id:"missing_tool",context:contextFor(s)})).code,"TOOL_NOT_FOUND");
 }],
 ["non-object arguments are rejected",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:null})).code,"INVALID_ARGUMENTS");
 }],
 ["accessor-backed arguments are rejected",async()=>{
  const r=makeToolRegistry(),s=createToolSession(),input={};
  Object.defineProperty(input,"value",{enumerable:true,get(){throw Error("getter must not run");}});
  assert.equal((await execute(r,{context:contextFor(s),input})).code,"INVALID_ARGUMENTS");
 }],
 ["unknown arguments are rejected",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:{value:"ok",admin:true}})).code,"UNKNOWN_ARGUMENT");
 }],
 ["required arguments are enforced",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:{count:1}})).code,"MISSING_ARGUMENT");
 }],
 ["string argument types are enforced",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:{value:42}})).code,"INVALID_ARGUMENT_TYPE");
 }],
 ["string maximum length is enforced",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:{value:"123456"}})).code,"INVALID_ARGUMENT_TYPE");
 }],
 ["integer argument types reject fractions",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:{value:"ok",count:1.5}})).code,"INVALID_ARGUMENT_TYPE");
 }],
 ["numeric ranges are enforced",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:{value:"ok",count:3}})).code,"ARGUMENT_OUT_OF_RANGE");
 }],
 ["boolean argument types are enforced",async()=>{
  const r=makeToolRegistry(),s=createToolSession();
  assert.equal((await execute(r,{context:contextFor(s),input:{value:"ok",flag:"yes"}})).code,"INVALID_ARGUMENT_TYPE");
 }],
 ["invalid session tokens are rejected",async()=>{
  const r=makeToolRegistry();
  assert.equal((await execute(r,{context:{allowToolExecution:true,allowedToolIds:["safe_read"],session:{}}})).code,"INVALID_TOOL_SESSION");
 }],
 ["session-wide call limit is enforced",async()=>{
  const r=makeToolRegistry(),s=createToolSession({maxCalls:1}),c=contextFor(s);
  assert.equal((await execute(r,{context:c})).ok,true);
  assert.equal((await execute(r,{context:c})).code,"TOOL_SESSION_CALL_LIMIT");
 }],
 ["per-tool call limit is enforced",async()=>{
  const r=makeToolRegistry({limits:{maxCalls:1}}),s=createToolSession({maxCalls:3}),c=contextFor(s);
  assert.equal((await execute(r,{context:c})).ok,true);
  assert.equal((await execute(r,{context:c})).code,"TOOL_CALL_LIMIT");
 }],
 ["timed-out handlers are aborted",async()=>{
  let signal;
  const r=makeToolRegistry({limits:{timeoutMs:10},handler:(_input,ctx)=>{signal=ctx.signal;return new Promise(()=>{});}});
  const result=await execute(r,{context:contextFor(createToolSession())});
  assert.equal(result.code,"TOOL_TIMEOUT");
  assert.equal(signal.aborted,true);
 }],
 ["oversized tool output is rejected",async()=>{
  const r=makeToolRegistry({limits:{maxOutputBytes:16},handler:async()=>({value:"x".repeat(100)})});
  assert.equal((await execute(r,{context:contextFor(createToolSession())})).code,"TOOL_OUTPUT_TOO_LARGE");
 }],
 ["circular tool output is rejected",async()=>{
  const circular={};circular.self=circular;
  const r=makeToolRegistry({handler:async()=>circular});
  assert.equal((await execute(r,{context:contextFor(createToolSession())})).code,"INVALID_TOOL_OUTPUT");
 }],
 ["undefined tool output is rejected",async()=>{
  const r=makeToolRegistry({handler:async()=>undefined});
  assert.equal((await execute(r,{context:contextFor(createToolSession())})).code,"INVALID_TOOL_OUTPUT");
 }],
 ["handler exceptions are normalized",async()=>{
  const r=makeToolRegistry({handler:async()=>{throw Error("sensitive internal detail");}});
  assert.equal((await execute(r,{context:contextFor(createToolSession())})).code,"TOOL_EXECUTION_FAILED");
 }]
];
for(const [name,fn] of toolCases)test("tool boundary: "+name,fn);

const fakeTools={
 get(id){return id==="safe_read"?{id}:null;},
 async execute(id,args){return {ok:true,result:{id,args}};}
};
function makeSkillRegistry({load=async()=>({content:"safe reference"}),allows=true}={}) {
 return {
  get(id){return id==="test_skill"?{id,version:"1.0.0",description:"Test skill",allowedToolIds:allows?["safe_read"]:[]}:null;},
  async load(id){return id==="test_skill"?load(id):null;},
  allows(_skillId,toolId){return allows&&toolId==="safe_read";}
 };
}
function makeLoop(options={}) {
 return createAgentLoop({toolRegistry:options.toolRegistry??fakeTools,skillRegistry:options.skillRegistry??makeSkillRegistry(),...options});
}
const baseArgs=plan=>({skillId:"test_skill",input:{task:"bounded test"},allowToolExecution:true,allowedToolIds:["safe_read"],plan});

const loopCases=[
 ["constructor requires a tool registry",async()=>{
  assert.throws(()=>createAgentLoop({skillRegistry:makeSkillRegistry()}),/TOOL_REGISTRY_REQUIRED/);
 }],
 ["constructor requires a skill registry",async()=>{
  assert.throws(()=>createAgentLoop({toolRegistry:fakeTools}),/SKILL_REGISTRY_REQUIRED/);
 }],
 ["constructor rejects excessive step limits",async()=>{
  assert.throws(()=>makeLoop({maxSteps:9}),/INVALID_MAX_STEPS/);
 }],
 ["constructor rejects excessive tool-call limits",async()=>{
  assert.throws(()=>makeLoop({maxToolCalls:9}),/INVALID_MAX_TOOL_CALLS/);
 }],
 ["constructor validates audit adapters",async()=>{
  assert.throws(()=>makeLoop({auditLog:{record:true}}),/INVALID_AUDIT_LOG/);
 }],
 ["constructor validates health adapters",async()=>{
  assert.throws(()=>makeLoop({healthMonitor:{record:true}}),/INVALID_HEALTH_MONITOR/);
 }],
 ["invalid shared budget tokens fail closed",async()=>{
  const loop=makeLoop();
  assert.equal((await loop.run({...baseArgs(async()=>({type:"final",output:"ok"})),budget:{used:0}})).code,"INVALID_AGENT_BUDGET");
 }],
 ["shared budget prevents overspending across runs",async()=>{
  const loop=makeLoop(),budget=createAgentBudget({maxToolCalls:1});
  const planner=async()=>({type:"tool",toolId:"safe_read",arguments:{value:"ok"}});
  const first=await loop.run({...baseArgs(planner),budget});
  const second=await loop.run({...baseArgs(planner),budget});
  assert.equal(first.code,"AGENT_STEP_LIMIT");
  assert.equal(second.code,"AGENT_SHARED_BUDGET_EXHAUSTED");
 }],
 ["agent step limit stops repeated planner tool decisions",async()=>{
  const loop=makeLoop({maxSteps:1});
  const result=await loop.run(baseArgs(async()=>({type:"tool",toolId:"safe_read",arguments:{value:"ok"}})));
  assert.equal(result.code,"AGENT_STEP_LIMIT");
 }],
 ["agent tool-call limit stops repeated tool decisions",async()=>{
  const loop=makeLoop({maxSteps:3,maxToolCalls:1});
  const result=await loop.run(baseArgs(async()=>({type:"tool",toolId:"safe_read",arguments:{value:"ok"}})));
  assert.equal(result.code,"AGENT_TOOL_CALL_LIMIT");
 }],
 ["final decisions must contain output",async()=>{
  const result=await makeLoop().run(baseArgs(async()=>({type:"final"})));
  assert.equal(result.code,"INVALID_PLAN");
 }],
 ["oversized final output is rejected",async()=>{
  const result=await makeLoop().run(baseArgs(async()=>({type:"final",output:"x".repeat(9000)})));
  assert.equal(result.code,"INVALID_FINAL_OUTPUT");
 }],
 ["skill content load failures fail closed",async()=>{
  const registry=makeSkillRegistry({load:async()=>{throw Error("load failed");}});
  const result=await makeLoop({skillRegistry:registry}).run(baseArgs(async()=>({type:"final",output:"ok"})));
  assert.equal(result.code,"SKILL_LOAD_FAILED");
 }],
 ["tool execution exceptions are normalized",async()=>{
  const toolRegistry={...fakeTools,async execute(){throw Error("private detail");}};
  const result=await makeLoop({toolRegistry}).run(baseArgs(async()=>({type:"tool",toolId:"safe_read",arguments:{value:"ok"}})));
  assert.equal(result.code,"TOOL_EXECUTION_FAILED");
 }],
 ["failed tool results stop the run",async()=>{
  const toolRegistry={...fakeTools,async execute(){return {ok:false,code:"REMOTE_DENIED"};}};
  const result=await makeLoop({toolRegistry}).run(baseArgs(async()=>({type:"tool",toolId:"safe_read",arguments:{value:"ok"}})));
  assert.equal(result.code,"REMOTE_DENIED");
 }],
 ["audit log records successful run lifecycle",async()=>{
  const events=[],loop=makeLoop({auditLog:{record:event=>events.push(event)}});
  const result=await loop.run(baseArgs(async()=>({type:"final",output:"ok"})));
  assert.equal(result.ok,true);
  assert.deepEqual(events.map(event=>event.type),["run_started","run_succeeded"]);
 }],
 ["audit adapter failures do not change execution result",async()=>{
  const loop=makeLoop({auditLog:{record(){throw Error("audit offline");}}});
  const result=await loop.run(baseArgs(async()=>({type:"final",output:"ok"})));
  assert.equal(result.ok,true);
 }],
 ["health telemetry failures do not change execution result",async()=>{
  const loop=makeLoop({healthMonitor:{record(){throw Error("metrics offline");}}});
  const result=await loop.run(baseArgs(async()=>({type:"final",output:"ok"})));
  assert.equal(result.ok,true);
 }],
 ["tool result context size is bounded",async()=>{
  const toolRegistry={...fakeTools,async execute(){return {ok:true,result:{data:"x".repeat(9000)}};}};
  const result=await makeLoop({toolRegistry}).run(baseArgs(async()=>({type:"tool",toolId:"safe_read",arguments:{value:"ok"}})));
  assert.equal(result.code,"AGENT_CONTEXT_TOO_LARGE");
 }],
 ["cyclic input is rejected before planning",async()=>{
  const input={};input.self=input;
  const result=await makeLoop().run({...baseArgs(async()=>({type:"final",output:"ok"})),input});
  assert.equal(result.code,"INPUT_TOO_LARGE_OR_INVALID");
 }]
];
for(const [name,fn] of loopCases)test("agent loop boundary: "+name,fn);
