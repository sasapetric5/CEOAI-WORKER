import test from "node:test";
import assert from "node:assert/strict";
import {createMemorySkillLifecycleStore,createSkillLifecycleManager} from "../src/agent/skill-lifecycle.mjs";

const review={sourcePinned:true,licenseVerified:true,hashVerified:true,dependenciesReviewed:true,scriptsReviewed:true,networkReviewed:true,credentialsReviewed:true};
async function candidate(manager,id="example_skill"){
 assert.equal((await manager.discover({id,metadata:{repository:"owner/repo"}})).ok,true);
}
test("new candidates remain non-selectable until every independent gate passes",async()=>{
 const manager=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore(),now:()=>100});
 await candidate(manager);
 assert.equal(manager.isSelectable(await manager.get("example_skill")),false);
 assert.equal((await manager.classifyCost("example_skill","free")).ok,true);
 assert.equal((await manager.recordSecurityReview("example_skill",review)).ok,true);
 assert.equal((await manager.recordQualityResult("example_skill",{passed:3,total:3,score:1})).record.status,"VERIFIED");
 assert.equal(manager.isSelectable(await manager.get("example_skill")),false);
 assert.equal((await manager.approveForActivation("example_skill")).code,"EXPLICIT_OWNER_APPROVAL_REQUIRED");
 assert.equal((await manager.approveForActivation("example_skill",{approvedByOwner:true})).record.status,"ACTIVE");
 assert.equal(manager.isSelectable(await manager.get("example_skill")),true);
});
test("paid and unknown-cost candidates cannot enter active selection",async()=>{
 const store=createMemorySkillLifecycleStore();const manager=createSkillLifecycleManager({storage:store});
 await candidate(manager,"paid_skill");
 assert.equal((await manager.classifyCost("paid_skill","paid")).record.status,"REJECTED");
 assert.equal(manager.isSelectable(await manager.get("paid_skill")),false);
 await candidate(manager,"unknown_skill");
 assert.equal((await manager.classifyCost("unknown_skill","unknown")).record.status,"QUARANTINED");
 assert.equal(manager.isSelectable(await manager.get("unknown_skill")),false);
});
test("incomplete security evidence cannot verify or activate a skill",async()=>{
 const manager=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore()});
 await candidate(manager);
 await manager.classifyCost("example_skill","free");
 assert.equal((await manager.recordSecurityReview("example_skill",{sourcePinned:true})).code,"SECURITY_REVIEW_INCOMPLETE");
 await manager.recordQualityResult("example_skill",{passed:2,total:2,score:1});
 assert.equal((await manager.get("example_skill")).status,"DISCOVERED");
 assert.equal((await manager.approveForActivation("example_skill",{approvedByOwner:true})).code,"SKILL_NOT_VERIFIED");
});
test("quality failures degrade then suspend and remove the skill from selection",async()=>{
 const manager=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore()});
 await candidate(manager);
 await manager.classifyCost("example_skill","free");
 await manager.recordSecurityReview("example_skill",review);
 assert.equal((await manager.recordQualityResult("example_skill",{passed:0,total:2,score:0})).record.status,"DEGRADED");
 assert.equal((await manager.recordQualityResult("example_skill",{passed:1,total:2,score:0.5})).record.status,"SUSPENDED");
 assert.equal(manager.isSelectable(await manager.get("example_skill")),false);
});
test("a previously verified skill is degraded after a later quality regression",async()=>{
 const manager=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore()});
 await candidate(manager);
 await manager.classifyCost("example_skill","free");
 await manager.recordSecurityReview("example_skill",review);
 await manager.recordQualityResult("example_skill",{passed:2,total:2,score:1});
 await manager.approveForActivation("example_skill",{approvedByOwner:true});
 assert.equal((await manager.recordQualityResult("example_skill",{passed:1,total:2,score:0.5})).record.status,"DEGRADED");
 assert.equal(manager.isSelectable(await manager.get("example_skill")),false);
});
test("concurrent state transitions fail closed instead of overwriting one another",async()=>{
 const base=createMemorySkillLifecycleStore();
 let barrierResolve;const barrier=new Promise(r=>barrierResolve=r);let reads=0;
 const storage={
  get:async key=>{const v=await base.get(key);if(v&&reads<2){reads++;if(reads===2)barrierResolve();await barrier;}return v;},
  putIfAbsent:(...args)=>base.putIfAbsent(...args),
  compareAndSet:(...args)=>base.compareAndSet(...args),
  list:(...args)=>base.list(...args)
 };
 const manager=createSkillLifecycleManager({storage});
 await candidate(manager);
 const outcomes=await Promise.all([manager.classifyCost("example_skill","free"),manager.classifyCost("example_skill","unknown")]);
 assert.equal(outcomes.filter(x=>x.ok).length,1);
 assert.equal(manager.isSelectable(await manager.get("example_skill")),false);
});
