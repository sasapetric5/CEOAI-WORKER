// Internal-only bridge from specialist orchestration to CEOAI's existing model provider pool.
import {createProviderAgentPlanner} from "./provider-agent-planner.mjs";
export function createProviderAgentRuntime({system,generateText,maxModelCalls=4,intent="reasoning"}={}){
 if(!system?.multiAgentSupervisor||typeof system.multiAgentSupervisor.run!=="function")throw new TypeError("AGENT_SUPERVISOR_REQUIRED");
 if(typeof generateText!=="function")throw new TypeError("MODEL_GENERATOR_REQUIRED");
 if(!Number.isSafeInteger(maxModelCalls)||maxModelCalls<1||maxModelCalls>8)throw new TypeError("INVALID_MODEL_CALL_BUDGET");
 async function runTask({task,input={},limit=3,agentIds,allowedToolIds=[],allowToolExecution=false,maxToolCalls=4,synthesize=true,runId=crypto.randomUUID()}={}){
  if(allowToolExecution!==true)return {ok:false,code:"EXECUTION_NOT_APPROVED",agents:[],results:[]};
  if(!Array.isArray(allowedToolIds)||allowedToolIds.some(id=>typeof id!=="string"))return {ok:false,code:"INVALID_CALLER_CAPABILITIES",agents:[],results:[]};
  const planner=createProviderAgentPlanner({generateText,maxModelCalls,intent});
  const result=await system.multiAgentSupervisor.run({
   task,input,limit,agentIds,allowedToolIds,allowToolExecution:true,maxToolCalls,runId,
   planAgent:planner.planAgent,
   synthesize:synthesize?planner.synthesize:null,
  });
  return {...result,modelUsage:planner.usage};
 }
 return Object.freeze({runTask});
}
