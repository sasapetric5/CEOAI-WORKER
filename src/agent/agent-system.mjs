// Complete CEOAI agent composition using existing KV_MEMORY and tool registry.
import {createKVSkillSystem,createBuiltinSkillSystem} from "./skill-system.mjs";
import {createAgentRegistry} from "./agent-registry.mjs";
import {BUILTIN_AGENTS} from "./builtin-agents.mjs";
import {createMultiAgentSupervisor} from "./multi-agent-supervisor.mjs";
import {createSkillMCPResources} from "./skill-mcp-resources.mjs";
function attach(skillSystem,{toolRegistry,maxAgents,maxToolCalls,capabilityRegistry=null,capabilityContext=null,requireDurableAuthority=false,mcpAuthorize=null,mcpAudit=null,mcpPageSize=20}){
 const agents=createAgentRegistry({agents:BUILTIN_AGENTS,skillRegistry:skillSystem.registry,toolRegistry});
 const supervisor=createMultiAgentSupervisor({agentRegistry:agents,skillRegistry:skillSystem.registry,agentLoop:skillSystem.agentLoop,capabilityRegistry,capabilityContext,requireDurableAuthority,maxAgents,maxToolCalls});
 const mcpResources=mcpAuthorize===null?null:createSkillMCPResources({skillRegistry:skillSystem.registry,authorize:mcpAuthorize,audit:mcpAudit,maxPageSize:mcpPageSize});
 return Object.freeze({...skillSystem,agents,multiAgentSupervisor:supervisor,mcpResources});
}
export function createBuiltinAgentSystem({toolRegistry,agentLoopFactory,maxAgents=3,maxToolCalls=4,capabilityRegistry=null,capabilityContext=null,requireDurableAuthority=false,mcpAuthorize=null,mcpAudit=null,mcpPageSize=20}={}){
 const skills=createBuiltinSkillSystem({toolRegistry,agentLoopFactory,maxSelectedSkills:3});
 if(!skills.agentLoop)throw new TypeError("AGENT_LOOP_FACTORY_REQUIRED");
 return attach(skills,{toolRegistry,maxAgents,maxToolCalls,capabilityRegistry,capabilityContext,mcpAuthorize,mcpAudit,mcpPageSize});
}
export async function createKVAgentSystem({
 kv,toolRegistry,agentLoopFactory,maxAgents=3,maxToolCalls=4,capabilityRegistry=null,capabilityContext=null,requireDurableAuthority=false,capabilityPolicy={},
 approvedSkillIds,categoryBySkillId={},categoryCapabilityPolicy={},indexKey,documentPrefix,
 mcpAuthorize=null,mcpAudit=null,mcpPageSize=20
}={}){
 const skills=await createKVSkillSystem({kv,toolRegistry,agentLoopFactory,maxSelectedSkills:3,capabilityPolicy,approvedSkillIds,categoryBySkillId,categoryCapabilityPolicy,indexKey,documentPrefix});
 if(!skills.agentLoop)throw new TypeError("AGENT_LOOP_FACTORY_REQUIRED");
 return attach(skills,{toolRegistry,maxAgents,maxToolCalls,capabilityRegistry,capabilityContext,requireDurableAuthority,mcpAuthorize,mcpAudit,mcpPageSize});
}
