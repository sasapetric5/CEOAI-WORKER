// Composition root for skill discovery and bounded execution.
import {BUILTIN_SKILLS,createBuiltinSkillRegistry} from "./builtin-skills.mjs";
import {createSkillSupervisor} from "./skill-supervisor.mjs";
import {createKVSkillRegistry} from "./skill-storage.mjs";
function compose({registry,toolRegistry,agentLoopFactory,maxSelectedSkills}){
 if(agentLoopFactory!==null&&typeof agentLoopFactory!=="function")throw new TypeError("INVALID_AGENT_LOOP_FACTORY");
 const agentLoop=agentLoopFactory?agentLoopFactory({toolRegistry,skillRegistry:registry}):null;
 return Object.freeze({registry,agentLoop,supervisor:createSkillSupervisor({skillRegistry:registry,agentLoop,maxSelectedSkills})});
}
export function createBuiltinSkillSystem({toolRegistry,agentLoopFactory=null,maxSelectedSkills=3}={}){
 const registry=createBuiltinSkillRegistry({toolRegistry});
 return compose({registry,toolRegistry,agentLoopFactory,maxSelectedSkills});
}
export async function createKVSkillSystem({
 kv,toolRegistry,agentLoopFactory=null,maxSelectedSkills=3,capabilityPolicy={},
 approvedSkillIds=BUILTIN_SKILLS.map(skill=>skill.id),categoryBySkillId={},
 categoryCapabilityPolicy={},indexKey,documentPrefix
}={}){
 const registry=await createKVSkillRegistry({kv,toolRegistry,capabilityPolicy,approvedSkillIds,categoryBySkillId,categoryCapabilityPolicy,indexKey,documentPrefix});
 return compose({registry,toolRegistry,agentLoopFactory,maxSelectedSkills});
}
