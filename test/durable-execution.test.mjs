import test from "node:test";
import assert from "node:assert/strict";
import { createDurableExecutionEngine, createMemoryCheckpointStore } from "../src/agent/durable-execution.mjs";

function fixture(options = {}) {
  const store = options.store || createMemoryCheckpointStore();
  const calls = [];
  const engine = createDurableExecutionEngine({
    store, now: options.now || (() => 1000),
    executeStep: options.executeStep || (async context => { calls.push(context); return { value: context.stepId }; }),
    audit: options.audit,
  });
  return { engine, store, calls };
}
const steps = [{ id: "plan", kind: "task" }, { id: "research", kind: "task" }, { id: "report", kind: "task" }];

test("01 creates a versioned durable task", async () => { const {engine}=fixture(); const r=await engine.create({id:"task_01",input:{goal:"x"},steps}); assert.equal(r.ok,true); assert.equal(r.state.version,1); assert.equal(r.state.status,"ready"); });
test("02 rejects invalid task identifiers", async () => { const {engine}=fixture(); assert.equal((await engine.create({id:"../bad",steps})).code,"INVALID_TASK_ID"); });
test("03 rejects an empty plan", async () => { const {engine}=fixture(); assert.equal((await engine.create({id:"task_02",steps:[]})).code,"INVALID_EXECUTION_PLAN"); });
test("04 rejects duplicate step identifiers", async () => { const {engine}=fixture(); assert.equal((await engine.create({id:"task_03",steps:[{id:"same",kind:"task"},{id:"same",kind:"task"}]})).code,"INVALID_EXECUTION_PLAN"); });
test("05 rejects unknown step kinds", async () => { const {engine}=fixture(); assert.equal((await engine.create({id:"task_04",steps:[{id:"step",kind:"shell"}]})).code,"INVALID_EXECUTION_PLAN"); });
test("06 rejects non-serializable input", async () => { const {engine}=fixture(); const x={}; x.self=x; assert.equal((await engine.create({id:"task_05",input:x,steps})).code,"INVALID_TASK_INPUT"); });
test("07 rejects oversized input", async () => { const {engine}=fixture(); assert.equal((await engine.create({id:"task_06",input:"x".repeat(26000),steps})).code,"INVALID_TASK_INPUT"); });
test("08 prevents duplicate task creation", async () => { const {engine}=fixture(); await engine.create({id:"task_07",steps}); assert.equal((await engine.create({id:"task_07",steps})).code,"TASK_ALREADY_EXISTS"); });
test("09 executes and checkpoints a bounded batch", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_08",steps}); const r=await engine.run("task_08",{maxSteps:2}); assert.equal(r.status,"ready"); assert.equal(r.state.cursor,2); assert.equal(calls.length,2); });
test("10 resumes exactly at the next uncompleted step", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_09",steps}); await engine.run("task_09",{maxSteps:1}); const r=await engine.run("task_09",{maxSteps:2}); assert.equal(r.status,"completed"); assert.deepEqual(calls.map(c=>c.stepId),["plan","research","report"]); });
test("11 exposes deterministic idempotency keys", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_10",steps}); await engine.run("task_10",{maxSteps:1}); assert.equal(calls[0].idempotencyKey,"task_10:plan"); });
test("12 pauses before a step requiring approval", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_11",steps:[{id:"prepare",kind:"task"},{id:"publish",kind:"task",requiresApproval:true}]}); const r=await engine.run("task_11"); assert.equal(r.status,"paused_approval"); assert.equal(calls.length,1); });
test("13 approval resumes the paused task", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_12",steps:[{id:"publish",kind:"task",requiresApproval:true}]}); const p=await engine.run("task_12"); const a=await engine.decideApproval("task_12",p.state.pendingApproval.id,"approve"); assert.equal(a.status,"ready"); const r=await engine.run("task_12"); assert.equal(r.status,"completed"); assert.equal(calls.length,1); });
test("14 rejection cancels without executing the protected step", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_13",steps:[{id:"transfer",kind:"approval"}]}); const p=await engine.run("task_13"); const r=await engine.decideApproval("task_13",p.state.pendingApproval.id,"reject"); assert.equal(r.status,"cancelled"); assert.equal(calls.length,0); });
test("15 rejects stale or forged approval identifiers", async () => { const {engine}=fixture(); await engine.create({id:"task_14",steps:[{id:"protected",kind:"approval"}]}); await engine.run("task_14"); assert.equal((await engine.decideApproval("task_14","wrong","approve")).code,"APPROVAL_NOT_PENDING"); });
test("16 rejects invalid run budgets", async () => { const {engine}=fixture(); await engine.create({id:"task_15",steps}); assert.equal((await engine.run("task_15",{maxSteps:99})).code,"INVALID_RUN_BUDGET"); });
test("17 fails closed when step execution throws", async () => { const {engine}=fixture({executeStep:async()=>{throw Error("secret");}}); await engine.create({id:"task_16",steps}); assert.equal((await engine.run("task_16")).code,"STEP_EXECUTION_FAILED"); assert.equal((await engine.get("task_16")).state.status,"failed"); });
test("18 rejects oversized step results", async () => { const {engine}=fixture({executeStep:async()=>"x".repeat(26000)}); await engine.create({id:"task_17",steps}); assert.equal((await engine.run("task_17")).code,"STEP_RESULT_INVALID_OR_TOO_LARGE"); });
test("19 supports explicit cancellation", async () => { const {engine}=fixture(); await engine.create({id:"task_18",steps}); assert.equal((await engine.cancel("task_18")).status,"cancelled"); });
test("20 does not rerun terminal tasks", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_19",steps:[{id:"only",kind:"task"}]}); await engine.run("task_19"); await engine.run("task_19"); assert.equal(calls.length,1); });
test("21 returns a stable not-found error", async () => { const {engine}=fixture(); assert.equal((await engine.get("missing")).code,"TASK_NOT_FOUND"); });
test("22 validates checkpoint store dependency", () => { assert.throws(()=>createDurableExecutionEngine({}),/CHECKPOINT_STORE_REQUIRED/); });
test("23 validates executor dependency", () => { assert.throws(()=>createDurableExecutionEngine({store:createMemoryCheckpointStore()}),/STEP_EXECUTOR_REQUIRED/); });
test("24 isolates audit failures from execution", async () => { const {engine}=fixture({audit:{record(){throw Error("audit");}}}); await engine.create({id:"task_20",steps:[{id:"only",kind:"task"}]}); assert.equal((await engine.run("task_20")).status,"completed"); });
test("25 persists state across engine instances sharing the store", async () => { const store=createMemoryCheckpointStore(); const first=fixture({store}); await first.engine.create({id:"task_21",steps}); await first.engine.run("task_21",{maxSteps:1}); const second=fixture({store}); const resumed=await second.engine.run("task_21",{maxSteps:2}); assert.equal(resumed.status,"completed"); assert.deepEqual(second.calls.map(c=>c.stepId),["research","report"]); });

test("26 accepts dense JSON arrays in checkpoint input", async () => { const {engine}=fixture(); const r=await engine.create({id:"task_26",input:{items:[1,"two",true,null]},steps}); assert.equal(r.ok,true); assert.deepEqual(r.state.input.items,[1,"two",true,null]); });
test("27 rejects sparse arrays in checkpoint input", async () => { const {engine}=fixture(); const sparse=[]; sparse.length=2; sparse[1]="x"; assert.equal((await engine.create({id:"task_27",input:{items:sparse},steps})).code,"INVALID_TASK_INPUT"); });
test("28 approval identifiers remain bounded for maximum-length task IDs", async () => { const {engine}=fixture(); const id="t".repeat(80); await engine.create({id,steps:[{id:"protected",kind:"approval"}]}); const p=await engine.run(id); assert.equal(p.status,"paused_approval"); assert.ok(p.state.pendingApproval.id.length<=80); assert.equal((await engine.decideApproval(id,p.state.pendingApproval.id,"approve")).status,"ready"); });
test("29 rejects non-finite checkpoint numbers", async () => { const {engine}=fixture(); assert.equal((await engine.create({id:"task_29",input:{value:NaN},steps})).code,"INVALID_TASK_INPUT"); });
test("30 rejects inherited plan step properties", async () => { const {engine}=fixture(); const inherited=Object.assign(Object.create({kind:"task"}),{id:"step"}); assert.equal((await engine.create({id:"task_30",steps:[inherited]})).code,"INVALID_EXECUTION_PLAN"); });
