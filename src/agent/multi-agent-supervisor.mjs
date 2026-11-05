// Bounded multi-agent orchestration. Agents run sequentially with one shared tool budget.
import {createAgentBudget} from "./agent-loop.mjs";
const MAX_CONTEXT_BYTES=8192;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const safeJson=value=>{try{const json=JSON.stringify(value);return typeof json==="string"&&new TextEncoder().encode(json).byteLength<=MAX_CONTEXT_BYTES?json:null;}catch{return null;}};
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
   if(!Array.isArray(agentIds)||!agentIds.length||agentIds.length>limit||agentIds.some(id=>typeof id!=="string")||new Set(agentIds).size!==agentIds.length)return {ok:false,code:"INVALID_AGENT_SELECTION",agents:[]};
   selected=agentIds.map(id=>agentRegistry.get(id));
   if(selected.some(a=>!a))return {ok:false,code:"AGENT_NOT_FOUND",agents:[]};
   const relevantSkills=skillRegistry.search(task.trim().slice(0,500),{limit:20});
   selected=selected.map(a=>{
    const match=relevantSkills.filter(s=>a.skillIds.includes(s.id)).sort((x,y)=>(y.score??0)-(x.score??0)||x.id.localeCompare(y.id))[0];
    return match?{...a,skillId:match.id,score:match.score,matchedTerms:match.matchedTerms??[]}:null;
   }).filter(Boolean);
  }else selected=agentRegistry.search(task,{limit});
  selected=selected.filter(a=>a.skillId&&skillRegistry.get(a.skillId));
  if(!selected.length)return {ok:false,code:"NO_RELEVANT_AGENT",agents:[]};
  return {ok:true,agents:selected.map(a=>({id:a.id,role:a.role,description:a.description,skillId:a.skillId,score:a.score??null,matchedTerms:a.matchedTerms??[],allowedToolIds:a.allowedToolIds}))};
 }
 async function run({task,input={},limit=maxAgents,agentIds,planAgent,allowedToolIds=[],allowToolExecution=false,synthesize=null,maxToolCalls:budgetLimit=maxToolCalls}={}){
  if(allowToolExecution!==true)return {ok:false,code:"EXECUTION_NOT_APPROVED",agents:[],results:[]};
  if(typeof planAgent!=="function")return {ok:false,code:"AGENT_PLANNER_REQUIRED",agents:[],results:[]};
  if(!Array.isArray(allowedToolIds)||allowedToolIds.some(id=>typeof id!=="string"))return {ok:false,code:"INVALID_CALLER_CAPABILITIES",agents:[],results:[]};
  if(synthesize!==null&&typeof synthesize!=="function")return {ok:false,code:"INVALID_SYNTHESIZER",agents:[],results:[]};
  if(!Number.isSafeInteger(budgetLimit)||budgetLimit<1||budgetLimit>maxToolCalls)return {ok:false,code:"INVALID_SHARED_BUDGET",agents:[],results:[]};
  if(safeJson(input)===null)return {ok:false,code:"INPUT_TOO_LARGE_OR_INVALID",agents:[],results:[]};
  const prepared=await prepare({task,limit,agentIds});
  if(!prepared.ok)return {...prepared,results:[]};
  const budget=createAgentBudget({maxToolCalls:budgetLimit}),results=[];
  for(const agent of prepared.agents){
   const skill=skillRegistry.get(agent.skillId);
   if(!skill){results.push({agentId:agent.id,ok:false,code:"SKILL_NOT_FOUND"});continue;}
   const effectiveTools=allowedToolIds.filter(id=>agent.allowedToolIds.includes(id)&&skill.allowedToolIds.includes(id));
   const runInput={task,input,agentId:agent.id,role:agent.role};
   if(safeJson(runInput)===null){results.push({agentId:agent.id,ok:false,code:"AGENT_CONTEXT_TOO_LARGE"});continue;}
   let result;
   try{
    result=await agentLoop.run({
     skillId:agent.skillId,input:runInput,allowToolExecution:true,allowedToolIds:effectiveTools,budget,
     plan:context=>planAgent({agent,skill:{id:skill.id,version:skill.version,description:skill.description},context,task,input,instructionTrust:"untrusted_reference_only"})
    });
   }catch{result={ok:false,code:"AGENT_INTERNAL_ERROR",steps:0,toolCalls:0};}
   results.push({agentId:agent.id,role:agent.role,skillId:agent.skillId,ok:result?.ok===true,...(result?.ok===true?{output:result.output,steps:result.steps,toolCalls:result.toolCalls}:{code:typeof result?.code==="string"?result.code:"AGENT_FAILED",steps:result?.steps??0,toolCalls:result?.toolCalls??0})});
  }
  const successful=results.filter(r=>r.ok);
  if(!successful.length)return {ok:false,code:"ALL_AGENTS_FAILED",agents:prepared.agents.map(a=>a.id),results,budgetUsed:results.reduce((n,r)=>n+(r.toolCalls||0),0)};
  let output=successful.map(r=>({agentId:r.agentId,role:r.role,skillId:r.skillId,output:r.output}));
  if(synthesize){
   try{const synthesized=await synthesize({task,results:output,failedAgents:results.filter(r=>!r.ok).map(r=>({agentId:r.agentId,code:r.code}))});if(safeJson(synthesized)===null)return {ok:false,code:"INVALID_SYNTHESIS_OUTPUT",agents:prepared.agents.map(a=>a.id),results};output=synthesized;}
   catch{return {ok:false,code:"SYNTHESIS_FAILED",agents:prepared.agents.map(a=>a.id),results};}
  }
  return {ok:true,output,agents:prepared.agents.map(a=>a.id),results,budgetUsed:results.reduce((n,r)=>n+(r.toolCalls||0),0),partial:results.some(r=>!r.ok)};
 }
 return Object.freeze({prepare,run});
}
