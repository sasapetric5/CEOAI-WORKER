// Composition root for skill discovery and bounded execution.
import {BUILTIN_SKILLS,createBuiltinSkillRegistry} from "./builtin-skills.mjs";
import {createSkillSupervisor} from "./skill-supervisor.mjs";
import {createKVSkillRegistry} from "./skill-storage.mjs";
import {createSkillAdmissionPipeline} from "./skill-admission-pipeline.mjs";
function compose({registry,toolRegistry,agentLoopFactory,maxSelectedSkills,skillLifecycle=null,securityFirewall=null,qualityEvaluator=null,verifyIntakeReview=null}){
 if(agentLoopFactory!==null&&typeof agentLoopFactory!=="function")throw new TypeError("INVALID_AGENT_LOOP_FACTORY");
 const agentLoop=agentLoopFactory?agentLoopFactory({toolRegistry,skillRegistry:registry}):null;
 const admissionConfigured=[securityFirewall,qualityEvaluator,verifyIntakeReview].some(value=>value!==null);
 const admissionPipeline=admissionConfigured?createSkillAdmissionPipeline({securityFirewall,skillLifecycle,qualityEvaluator,verifyIntakeReview}):null;
 return Object.freeze({registry,agentLoop,admissionPipeline,supervisor:createSkillSupervisor({skillRegistry:registry,agentLoop,maxSelectedSkills,skillLifecycle})});
}
export function createBuiltinSkillSystem({toolRegistry,agentLoopFactory=null,maxSelectedSkills=3,skillLifecycle=null,securityFirewall=null,qualityEvaluator=null,verifyIntakeReview=null}={}){
 const registry=createBuiltinSkillRegistry({toolRegistry});
 return compose({registry,toolRegistry,agentLoopFactory,maxSelectedSkills,skillLifecycle,securityFirewall,qualityEvaluator,verifyIntakeReview});
}
export async function createKVSkillSystem({
 kv,toolRegistry,agentLoopFactory=null,maxSelectedSkills=3,capabilityPolicy={},
 approvedSkillIds=BUILTIN_SKILLS.map(skill=>skill.id),categoryBySkillId={},
 categoryCapabilityPolicy={},indexKey,documentPrefix,skillLifecycle=null,securityFirewall=null,qualityEvaluator=null,verifyIntakeReview=null
}={}){
 const registry=await createKVSkillRegistry({kv,toolRegistry,capabilityPolicy,approvedSkillIds,categoryBySkillId,categoryCapabilityPolicy,indexKey,documentPrefix,skillLifecycle});
 return compose({registry,toolRegistry,agentLoopFactory,maxSelectedSkills,skillLifecycle,securityFirewall,qualityEvaluator,verifyIntakeReview});
}
