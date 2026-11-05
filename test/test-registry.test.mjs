import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryTestEvidenceStore, createTestRegistry } from "../src/agent/test-registry.mjs";
const base={id:"langgraph_checkpoint_resume",title:"Checkpoint resume behavior",category:"durability",sourceProject:"LangGraph",sourceRepository:"langchain-ai/langgraph",sourcePath:"libs/langgraph/tests/test_pregel_async.py",sourceCommit:"60cbb4af560d71fc5b9cd81dbb5ed46b5525d09b",license:"MIT",licenseDecision:"approved",adapterPath:"test/durable-execution.test.mjs",status:"adapted",tags:["checkpoint","resume"]};
const evidence={commitSha:"a".repeat(40),workflowRunUrl:"https://github.com/sasapetric5/CEOAI-WORKER/actions/runs/123456",command:"npm run verify",runtime:"node 22",startedAt:1000,completedAt:2000,exitCode:0,result:"passed",signature:"signed-ci-evidence-placeholder-0123456789"};
test("registers adapted test metadata but never self-approves executed status",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:()=>true});
 assert.equal((await registry.register(base)).ok,true);
 assert.equal((await registry.register({...base,id:"fake_pass",status:"executed_pass"})).code,"EXECUTION_EVIDENCE_REQUIRED");
});
test("requires license approval before registration and execution",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:()=>true});
 assert.equal((await registry.register({...base,licenseDecision:"pending"})).code,"LICENSE_NOT_APPROVED");
});
test("only verified successful CI evidence creates executed_pass",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:e=>e.signature.startsWith("signed-")});
 await registry.register(base);
 const out=await registry.recordExecution(base.id,evidence);
 assert.equal(out.status,"executed_pass");
 const record=await registry.get(base.id);
 assert.equal(record.passCount,1);assert.equal(record.verifiedPass,true);
});
test("failed, skipped and nonzero runs never count as passed",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:()=>true});
 await registry.register(base);
 const out=await registry.recordExecution(base.id,{...evidence,exitCode:1,result:"failed",workflowRunUrl:"https://github.com/sasapetric5/CEOAI-WORKER/actions/runs/123457"});
 assert.equal(out.status,"executed_fail");
 assert.equal((await registry.get(base.id)).verifiedPass,false);
});
test("rejects forged or malformed CI evidence",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:()=>false});
 await registry.register(base);
 assert.equal((await registry.recordExecution(base.id,evidence)).code,"UNVERIFIED_CI_EVIDENCE");
 assert.equal((await registry.recordExecution(base.id,{...evidence,workflowRunUrl:"https://evil.example/run/1"})).code,"INVALID_TEST_EVIDENCE");
});
test("evidence is append-only and duplicate workflow runs are rejected",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:()=>true});
 await registry.register(base);
 assert.equal((await registry.recordExecution(base.id,evidence)).ok,true);
 assert.equal((await registry.recordExecution(base.id,evidence)).code,"EVIDENCE_ALREADY_RECORDED");
});
test("unknown test IDs and non-adapted tests cannot receive pass evidence",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:()=>true});
 assert.equal((await registry.recordExecution("missing_test",evidence)).code,"TEST_RECORD_NOT_FOUND");
 await registry.register({...base,id:"candidate_test",status:"candidate"});
 assert.equal((await registry.recordExecution("candidate_test",evidence)).code,"TEST_NOT_ADAPTED");
});
test("storage must support atomic append-only writes",()=>{
 assert.throws(()=>createTestRegistry({storage:{get:async()=>null,list:async()=>[]},verifyEvidence:()=>true}),/ATOMIC_TEST_EVIDENCE_STORAGE_REQUIRED/);
});
test("test listing filters category and status",async()=>{
 const registry=createTestRegistry({storage:createMemoryTestEvidenceStore(),verifyEvidence:()=>true});
 await registry.register(base);
 await registry.register({...base,id:"crew_delegation",category:"coordination",status:"candidate"});
 assert.equal((await registry.list({category:"durability"})).length,1);
 assert.equal((await registry.list({status:"candidate"})).length,1);
});
