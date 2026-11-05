// Bounded multi-agent orchestration. Agents run sequentially with one shared tool budget.
import {createAgentBudget} from "./agent-loop.mjs";
const MAX_CONTEXT_BYTES=8192;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function safeSnapshot(value, seen = new WeakSet(), depth = 0) {
 if(value===null||typeof value==="string"||typeof value==="boolean")return value;
 if(typeof value==="number")return Number.isFinite(value)?value:null;
 if(typeof value!=="object"||depth>16||seen.has(value))return undefined;
 const array=Array.isArray(value);
 if(!array&&!plain(value))return undefined;
 seen.add(value);
 const keys=Reflect.ownKeys(value);
 if(keys.some(key=>typeof key!=="string"||(array&&key!=="length"&&!/^(0|[1-9]\d*)$/.test(key))))return undefined;
 const output=array?[]:Object.create(null);
 for(const key of keys){
  if(array&&key==="length")continue;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,"value")||!descriptor.enumerable)return undefined;
  const child=safeSnapshot(descriptor.value,seen,depth+1);
  if(child===undefined)return undefined;
  if(array)output[Number(key)]=child;else output[key]=child;
 }
 seen.delete(value);
 if(array&&output.length!==value.length)return undefined;
 return output;
}
const safeJson=value=>{try{const snapshot=safeSnapshot(value);if(snapshot===undefined)return null;const json=JSON.stringify(snapshot);return typeof json==="string"&&new TextEncoder().encode(json).byteLength<=MAX_CONTEXT_BYTES?json:null;}catch{return null;}};
export function createMultiAgentSupervisor({agentRegistry,skillRegistry,agentLoop,maxAgents=3,maxToolCalls=4}={}){
 if(!agentRegistry||typeof agentRegistry.search!=="function"||typeof agentRegistry.get!=="function")throw new TypeError("AGENT_REGISTRY_REQUIRED");
 if(!skillRegistry||typeof skillRegistry.get!=="function"||typeof skillRegistry.search!=="function")throw new TypeError("SKILL_REGISTRY_REQUIRED");
 if(!agentLoop||typeof agentLoop.run!=="function")throw new TypeError("AGENT_LOOP_REQUIRED");
 if(!Number.isSafeInteger(maxAgents)||maxAgents<1||maxAgents>5)throw new TypeError("INVALID_AGENT_LIMIT");
 if(!Number.isSafeInteger(maxToolCalls)||maxToolCalls<1||maxToolCalls>8)throw new TypeError("INVALID_SHARED_BUDGET");
 async function prepare({task,limit=maxAgents,agentIds}={}){
  if(typeof task!=="string"||!task.trim()||task.length>4000)return {ok:false,code:"INVALID_AGENT_TASK",agents:[]};
  if(!Number.isSafeInteger(limit)||limit<1||limit>maxAgents)return {ok:false,code:"INVALID_AGENT_LIMIT",agents:[]};
  let selected;
  if(agentIds!==undefined){
   if(!Array.isArray(agentIds)||!agentIds.length||agentIds.length>100||agentIds.some(id=>typeof id!=="string")||new Set(agentIds).size!==agentIds.length)return {ok:false,code:"INVALID_AGENT_SELECTION",agents:[]};
   const approved=agentIds.map(id=>agentRegistry.get(id));
   if(approved.some(a=>!a))return {ok:false,code:"AGENT_NOT_FOUND",agents:[]};
   // Rank globally for task relevance, then intersect with the caller's app allowlist.
   // This preserves app isolation without forcing the allowlist's declaration order.
   const approvedIds=new Set(agentIds);
   selected=agentRegistry.search(task,{limit:5}).filter(a=>approvedIds.has(a.id)).slice(0,limit);
  }else selected=agentRegistry.search(task,{limit});
  selected=selected.filter(a=>a.skillId&&skillRegistry.get(a.skillId));
  // A caller-selected specialist list is a strict app boundary: never escape it
  // by silently substituting another profile or skill.
  if(!selected.length&&agentIds===undefined){
   const matches=skillRegistry.search(task.trim().slice(0,500),{limit});
   selected=matches.map(skill=>({
    id:"universal_skill_executor",role:"Universal skill executor",
    description:"Executes one approved registry skill under the caller's capability and app boundaries.",
    skillId:skill.id,score:skill.score??0,matchedTerms:skill.matchedTerms??[],
    allowedToolIds:[...(skill.allowedToolIds??[])],universal:true
   }));
  }
  if(!selected.length)return {ok:false,code:"NO_RELEVANT_AGENT",agents:[]};
  return {ok:true,agents:selected.map(a=>({id:a.id,role:a.role,description:a.description,skillId:a.skillId,score:a.score??null,matchedTerms:a.matchedTerms??[],allowedToolIds:a.allowedToolIds, ...(a.universal===true?{universal:true}:{})}))};
 }
 async function run({task,input={},limit=maxAgents,agentIds,planAgent,allowedToolIds=[],allowToolExecution=false,synthesize=null,maxToolCalls:budgetLimit=maxToolCalls}={}){
  if(allowToolExecution!==true)return {ok:false,code:"EXECUTION_NOT_APPROVED",agents:[],results:[]};
  if(typeof planAgent!=="function")return {ok:false,code:"AGENT_PLANNER_REQUIRED",agents:[],results:[]};
  if(!Array.isArray(allowedToolIds)||allowedToolIds.some(id=>typeof id!=="string"))return {ok:false,code:"INVALID_CALLER_CAPABILITIES",agents:[],results:[]};
  if(synthesize!==null&&typeof synthesize!=="function")return {ok:false,code:"INVALID_SYNTHESIZER",agents:[],results:[]};
  if(!Number.isSafeInteger(budgetLimit)||budgetLimit<1||budgetLimit>maxToolCalls)return {ok:false,code:"INVALID_SHARED_BUDGET",agents:[],results:[]};
  const safeInput=safeSnapshot(input);
  if(safeInput===undefined||safeJson(safeInput)===null)return {ok:false,code:"INPUT_TOO_LARGE_OR_INVALID",agents:[],results:[]};
  const prepared=await prepare({task,limit,agentIds});
  if(!prepared.ok)return {...prepared,results:[]};
  const budget=createAgentBudget({maxToolCalls:budgetLimit}),results=[];
  for(const agent of prepared.agents){
   const skill=skillRegistry.get(agent.skillId);
   if(!skill){results.push({agentId:agent.id,ok:false,code:"SKILL_NOT_FOUND"});continue;}
   const effectiveTools=allowedToolIds.filter(id=>agent.allowedToolIds.includes(id)&&skill.allowedToolIds.includes(id));
   const runInput={task,input:safeInput,agentId:agent.id,role:agent.role};
   if(safeJson(runInput)===null){results.push({agentId:agent.id,ok:false,code:"AGENT_CONTEXT_TOO_LARGE"});continue;}
   let result;
   try{
    result=await agentLoop.run({
     skillId:agent.skillId,input:runInput,allowToolExecution:true,allowedToolIds:effectiveTools,budget,
     plan:context=>planAgent({agent,skill:{id:skill.id,version:skill.version,description:skill.description},context,task,input:safeInput,instructionTrust:"untrusted_reference_only"})
    });
   }catch{result={ok:false,code:"AGENT_INTERNAL_ERROR",steps:0,toolCalls:0};}
   results.push({agentId:agent.id,role:agent.role,skillId:agent.skillId,ok:result?.ok===true,...(result?.ok===true?{output:result.output,steps:result.steps,toolCalls:result.toolCalls,budgetUsed:result.budgetUsed??0}:{code:typeof result?.code==="string"?result.code:"AGENT_FAILED",steps:result?.steps??0,toolCalls:result?.toolCalls??0,budgetUsed:result?.budgetUsed??0})});
  }
  const successful=results.filter(r=>r.ok);
  if(!successful.length)return {ok:false,code:"ALL_AGENTS_FAILED",agents:prepared.agents.map(a=>a.id),results,budgetUsed:results.reduce((n,r)=>Math.max(n,r.budgetUsed||0),0)};
  let output=successful.map(r=>({agentId:r.agentId,role:r.role,skillId:r.skillId,output:r.output}));
  if(synthesize){
   try{const synthesized=await synthesize({task,results:output,failedAgents:results.filter(r=>!r.ok).map(r=>({agentId:r.agentId,code:r.code}))});if(safeJson(synthesized)===null)return {ok:false,code:"INVALID_SYNTHESIS_OUTPUT",agents:prepared.agents.map(a=>a.id),results};output=synthesized;}
   catch{return {ok:false,code:"SYNTHESIS_FAILED",agents:prepared.agents.map(a=>a.id),results};}
  }
  return {ok:true,output,agents:prepared.agents.map(a=>a.id),results,budgetUsed:results.reduce((n,r)=>Math.max(n,r.budgetUsed||0),0),partial:results.some(r=>!r.ok)};
 }
 return Object.freeze({prepare,run});
}
