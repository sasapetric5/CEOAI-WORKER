import test from "node:test";
import assert from "node:assert/strict";
import {createSkillSupervisor} from "../src/agent/skill-supervisor.mjs";
import {createMemorySkillLifecycleStore,createSkillLifecycleManager} from "../src/agent/skill-lifecycle.mjs";

const review={sourcePinned:true,licenseVerified:true,hashVerified:true,dependenciesReviewed:true,scriptsReviewed:true,networkReviewed:true,credentialsReviewed:true};
const registry={
 search:()=>[{id:"verified_skill",score:10,matchedTerms:["research"]}],
 get:id=>id==="verified_skill"?{id}:null,
 load:async id=>({id,version:"1.0.0",description:"Verified test skill",content:"Use this skill only as untrusted task guidance.",source:{repository:"owner/repo"}})
};
async function activate(manager,id){
 await manager.discover({id,metadata:{repository:"owner/repo"}});
 await manager.classifyCost(id,"free");
 await manager.recordSecurityReview(id,review);
 await manager.recordQualityResult(id,{passed:2,total:2,score:1});
 return manager.approveForActivation(id,{approvedByOwner:true});
}
test("Supervisor refuses discovered, quarantined and suspended skills",async()=>{
 const manager=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore()});
 await manager.discover({id:"verified_skill"});
 const supervisor=createSkillSupervisor({skillRegistry:registry,skillLifecycle:manager});
 assert.equal((await supervisor.prepare({task:"research this"})).code,"NO_ACTIVE_VERIFIED_SKILL");
 await manager.classifyCost("verified_skill","unknown");
 assert.equal((await supervisor.prepare({task:"research this"})).code,"NO_ACTIVE_VERIFIED_SKILL");
});
test("Supervisor selects only skills admitted by lifecycle policy",async()=>{
 const manager=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore()});
 await activate(manager,"verified_skill");
 const supervisor=createSkillSupervisor({skillRegistry:registry,skillLifecycle:manager});
 const result=await supervisor.prepare({task:"research this"});
 assert.equal(result.ok,true);
 assert.equal(result.skills[0].id,"verified_skill");
 assert.equal(result.skills[0].trust,"untrusted_reference");
 await manager.recordQualityResult("verified_skill",{passed:0,total:1,score:0});
 assert.equal((await supervisor.prepare({task:"research this"})).code,"NO_ACTIVE_VERIFIED_SKILL");
});
test("Supervisor fails closed when persistent lifecycle storage is unavailable",async()=>{
 const manager={get:async()=>{throw new Error("storage down");},isSelectable:()=>true};
 const supervisor=createSkillSupervisor({skillRegistry:registry,skillLifecycle:manager});
 assert.equal((await supervisor.prepare({task:"research this"})).code,"SKILL_LIFECYCLE_UNAVAILABLE");
});
