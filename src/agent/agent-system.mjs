// Complete CEOAI agent composition using existing KV_MEMORY and tool registry.
import {createKVSkillSystem,createBuiltinSkillSystem} from "./skill-system.mjs";
import {createAgentRegistry} from "./agent-registry.mjs";
import {BUILTIN_AGENTS} from "./builtin-agents.mjs";
import {createMultiAgentSupervisor} from "./multi-agent-supervisor.mjs";
function attach(skillSystem,{toolRegistry,maxAgents,maxToolCalls}){
 const agents=createAgentRegistry({agents:BUILTIN_AGENTS,skillRegistry:skillSystem.registry,toolRegistry});
 const supervisor=createMultiAgentSupervisor({agentRegistry:agents,skillRegistry:skillSystem.registry,agentLoop:skillSystem.agentLoop,maxAgents,maxToolCalls});
 return Object.freeze({...skillSystem,agents,multiAgentSupervisor:supervisor});
}
export function createBuiltinAgentSystem({toolRegistry,agentLoopFactory,maxAgents=3,maxToolCalls=4}={}){
 const skills=createBuiltinSkillSystem({toolRegistry,agentLoopFactory,maxSelectedSkills:3});
 if(!skills.agentLoop)throw new TypeError("AGENT_LOOP_FACTORY_REQUIRED");
 return attach(skills,{toolRegistry,maxAgents,maxToolCalls});
}
export async function createKVAgentSystem({kv,toolRegistry,agentLoopFactory,maxAgents=3,maxToolCalls=4,capabilityPolicy={},indexKey,documentPrefix}={}){
 const skills=await createKVSkillSystem({kv,toolRegistry,agentLoopFactory,maxSelectedSkills:3,capabilityPolicy,indexKey,documentPrefix});
 if(!skills.agentLoop)throw new TypeError("AGENT_LOOP_FACTORY_REQUIRED");
 return attach(skills,{toolRegistry,maxAgents,maxToolCalls});
}
