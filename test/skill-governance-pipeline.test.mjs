import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGitHubSkillSource } from "../src/agent/github-skill-source.mjs";
import { createSkillGovernancePipeline } from "../src/agent/skill-governance-pipeline.mjs";
import { createSkillLifecycleManager, createMemorySkillLifecycleStore } from "../src/agent/skill-lifecycle.mjs";

const sha1="a".repeat(40);
const repo="trusted/skills";
const path="skills/demo/SKILL.md";
const text="Use the supplied facts to produce a concise, accurate summary.";
const hash=value=>createHash("sha256").update(value).digest("hex");
const candidate={id:"demo_skill",repository:repo,path,commit:sha1,blobSha:sha1};
function pipelineOptions({cost="free",review=true,output="expected"}={}) {
 const lifecycle=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore(),now:()=>100});
 const source={approvedRepositories:[repo],discover:async()=>[candidate],fetchCandidate:async()=>({
  ok:true,candidate,content:text,license:"MIT",files:[path],contentSha256:hash(text)
 })};
 const pipeline=createSkillGovernancePipeline({
  securityFirewall:{scan:async ({contentSha256})=>({ok:true,status:"clean",contentSha256})},
  source,lifecycle,
  costVerifier:async()=>({status:cost}),
  reviewCandidate:async()=>({dependenciesReviewed:review,scriptsReviewed:review,networkReviewed:review,credentialsReviewed:review}),
  testCasesForSkill:async()=>[{id:"summary",input:{text:"hello"},expectedOutput:"expected"}],
  executeCase:async()=>({output})
 });
 return {pipeline,lifecycle};
}

test("pinned GitHub source discovers only SKILL.md files at the configured immutable commit",async()=>{
 const tree={truncated:false,tree:[
  {type:"blob",path:"skills/a/SKILL.md",sha:sha1},
  {type:"blob",path:"scripts/install.sh",sha:sha1},
  {type:"blob",path:"skills/b/SKILL.md",sha:"b".repeat(40)}
 ]};
 const source=createGitHubSkillSource({repositories:[{repository:repo,commit:sha1}],fetchImpl:async url=>({
  ok:true,json:async()=>tree
 })});
 const found=await source.discover();
 assert.equal(found.length,2);
 assert.ok(found.every(x=>x.commit===sha1));
 assert.ok(found.every(x=>x.path.endsWith("SKILL.md")));
});

test("full intake pipeline links source, cost, security, functional evaluator and lifecycle",async()=>{
 const {pipeline,lifecycle}=pipelineOptions();
 const result=await pipeline.runBatch({limit:5});
 assert.equal(result.ok,true);
 assert.equal(result.discovered,1);
 assert.equal(result.verified,1);
 assert.equal(result.results[0].activated,false);
 const record=await lifecycle.get(candidate.id);
 assert.equal(record.status,"VERIFIED");
 assert.equal(record.costStatus,"free");
 assert.equal(record.securityReview.hashVerified,true);
 assert.equal(record.quality.lastResult.passed,1);
 assert.equal(record.ownerApproved,false);
});

test("unknown costs and incomplete reviews remain quarantined",async()=>{
 const unknown=pipelineOptions({cost:"unknown"});
 const a=await unknown.pipeline.runBatch();
 assert.equal(a.ok,false);
 assert.equal((await unknown.lifecycle.get(candidate.id)).status,"QUARANTINED");
 assert.equal((await unknown.lifecycle.get(candidate.id)).failureCount,1);
 const incomplete=pipelineOptions({review:false});
 const b=await incomplete.pipeline.runBatch();
 assert.equal(b.ok,false);
 assert.equal(b.results[0].code,"SECURITY_REVIEW_INCOMPLETE");
 assert.equal((await incomplete.lifecycle.get(candidate.id)).securityReview,null);
 assert.equal((await incomplete.lifecycle.get(candidate.id)).lastFailure.code,"SECURITY_REVIEW_INCOMPLETE");
});

test("functional output mismatch is recorded as degradation, never verified",async()=>{
 const {pipeline,lifecycle}=pipelineOptions({output:"wrong"});
 const result=await pipeline.runBatch();
 assert.equal(result.ok,true);
 assert.equal(result.verified,0);
 assert.equal(result.results[0].status,"DEGRADED");
 assert.equal((await lifecycle.get(candidate.id)).quality.lastResult.score,0);
});

test("paid skill is rejected before any security review or functional execution",async()=>{
 const {pipeline,lifecycle}=pipelineOptions({cost:"paid"});
 const result=await pipeline.runBatch();
 assert.equal(result.ok,false);
 assert.equal(result.results[0].code,"PAID_SKILL_REJECTED");
 assert.equal((await lifecycle.get(candidate.id)).status,"REJECTED");
 assert.equal((await lifecycle.get(candidate.id)).lastFailure.code,"PAID_SKILL_REJECTED");
});

test("owner-approved recovery re-runs source, cost, security and quality gates",async()=>{
 const {pipeline,lifecycle}=pipelineOptions();
 await lifecycle.discover({id:candidate.id,metadata:{repository:repo,path,commit:sha1,blobSha:sha1}});
 await lifecycle.classifyCost(candidate.id,"free");
 await lifecycle.recordQualityResult(candidate.id,{passed:0,total:1,score:0});
 await lifecycle.recordQualityResult(candidate.id,{passed:0,total:1,score:0});
 assert.equal((await lifecycle.get(candidate.id)).status,"SUSPENDED");
 assert.equal((await pipeline.recover(candidate.id)).code,"EXPLICIT_OWNER_APPROVAL_REQUIRED");
 const result=await pipeline.recover(candidate.id,{approvedByOwner:true});
 assert.equal(result.ok,true);
 assert.equal(result.status,"VERIFIED");
 assert.equal(result.activated,false);
 assert.equal((await lifecycle.get(candidate.id)).ownerApproved,false);
});

test("repeated scheduled quality failures degrade then suspend and stop automatic retries",async()=>{
 const {pipeline,lifecycle}=pipelineOptions({output:"wrong"});
 const first=await pipeline.runBatch();
 assert.equal(first.results[0].status,"DEGRADED");
 const second=await pipeline.runBatch();
 assert.equal(second.results[0].status,"SUSPENDED");
 assert.equal((await lifecycle.get(candidate.id)).quality.consecutiveFailures,2);
 const third=await pipeline.runBatch();
 assert.equal(third.results[0].code,"SKILL_SUSPENDED_REQUIRES_OWNER_RECOVERY");
});

test("security firewall blocks intake and records quarantine before reviewer or quality runner",async()=>{
 const lifecycle=createSkillLifecycleManager({storage:createMemorySkillLifecycleStore(),now:()=>100});
 let reviewerCalls=0;
 let runnerCalls=0;
 const source={approvedRepositories:[repo],discover:async()=>[candidate],fetchCandidate:async()=>({
  ok:true,candidate,content:text,license:"MIT",files:[path],contentSha256:hash(text)
 })};
 const pipeline=createSkillGovernancePipeline({
  source,lifecycle,
  costVerifier:async()=>({status:"free"}),
  securityFirewall:{scan:async()=>({ok:false,code:"SCANNER_UNAVAILABLE",severity:"quarantine"})},
  reviewCandidate:async()=>{reviewerCalls++;return {dependenciesReviewed:true,scriptsReviewed:true,networkReviewed:true,credentialsReviewed:true};},
  testCasesForSkill:async()=>[{id:"summary",input:{text:"hello"},expectedOutput:"expected"}],
  executeCase:async()=>{runnerCalls++;return {output:"expected"};}
 });
 const result=await pipeline.runBatch();
 assert.equal(result.ok,false);
 assert.equal(result.results[0].code,"SCANNER_UNAVAILABLE");
 assert.equal((await lifecycle.get(candidate.id)).status,"QUARANTINED");
 assert.equal(reviewerCalls,0);
 assert.equal(runnerCalls,0);
});
