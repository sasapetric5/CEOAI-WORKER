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
test("17 fails closed when step execution throws", async () => { const {engine}=fixture({executeStep:async()=>{throw Error("secret");}}); await engine.create({id:"task_16",steps}); assert.equal((await engine.run("task_16")).status,"paused_reconciliation"); assert.equal((await engine.get("task_16")).state.status,"paused_reconciliation"); });
test("18 rejects oversized step results", async () => { const {engine}=fixture({executeStep:async()=>"x".repeat(26000)}); await engine.create({id:"task_17",steps}); assert.equal((await engine.run("task_17")).status,"paused_reconciliation"); });
test("19 supports explicit cancellation", async () => { const {engine}=fixture(); await engine.create({id:"task_18",steps}); assert.equal((await engine.cancel("task_18")).status,"cancelled"); });
test("20 does not rerun terminal tasks", async () => { const {engine,calls}=fixture(); await engine.create({id:"task_19",steps:[{id:"only",kind:"task"}]}); await engine.run("task_19"); await engine.run("task_19"); assert.equal(calls.length,1); });
test("21 returns a stable not-found error", async () => { const {engine}=fixture(); assert.equal((await engine.get("missing")).code,"TASK_NOT_FOUND"); });
test("22 validates checkpoint store dependency", () => { assert.throws(()=>createDurableExecutionEngine({}),/LEASE_IDEMPOTENCY_CHECKPOINT_STORE_REQUIRED/); });
test("23 validates executor dependency", () => { const store=createMemoryCheckpointStore(); assert.throws(()=>createDurableExecutionEngine({store,executeStep:async()=>null}),/INVALID_DEPENDENCY/); });
test("24 isolates audit failures from execution", async () => { const {engine}=fixture({audit:{record(){throw Error("audit");}}}); await engine.create({id:"task_20",steps:[{id:"only",kind:"task"}]}); assert.equal((await engine.run("task_20")).status,"completed"); });
test("25 persists state across engine instances sharing the store", async () => { const store=createMemoryCheckpointStore(); const first=fixture({store}); await first.engine.create({id:"task_21",steps}); await first.engine.run("task_21",{maxSteps:1}); const second=fixture({store}); const resumed=await second.engine.run("task_21",{maxSteps:2}); assert.equal(resumed.status,"completed"); assert.deepEqual(second.calls.map(c=>c.stepId),["research","report"]); });

test("26 accepts dense JSON arrays in checkpoint input", async () => { const {engine}=fixture(); const r=await engine.create({id:"task_26",input:{items:[1,"two",true,null]},steps}); assert.equal(r.ok,true); assert.deepEqual(r.state.input.items,[1,"two",true,null]); });
test("27 rejects sparse arrays in checkpoint input", async () => { const {engine}=fixture(); const sparse=[]; sparse.length=2; sparse[1]="x"; assert.equal((await engine.create({id:"task_27",input:{items:sparse},steps})).code,"INVALID_TASK_INPUT"); });
test("28 approval identifiers remain bounded for maximum-length task IDs", async () => { const {engine}=fixture(); const id="t".repeat(80); await engine.create({id,steps:[{id:"protected",kind:"approval"}]}); const p=await engine.run(id); assert.equal(p.status,"paused_approval"); assert.ok(p.state.pendingApproval.id.length<=80); assert.equal((await engine.decideApproval(id,p.state.pendingApproval.id,"approve")).status,"ready"); });
test("29 rejects non-finite checkpoint numbers", async () => { const {engine}=fixture(); assert.equal((await engine.create({id:"task_29",input:{value:NaN},steps})).code,"INVALID_TASK_INPUT"); });
test("30 rejects inherited plan step properties", async () => { const {engine}=fixture(); const inherited=Object.assign(Object.create({kind:"task"}),{id:"step"}); assert.equal((await engine.create({id:"task_30",steps:[inherited]})).code,"INVALID_EXECUTION_PLAN"); });


test("31 releases its task lease after a successful bounded run", async () => {
  const { engine } = fixture();
  await engine.create({ id: "task_31", steps: [{ id: "only", kind: "task" }] });
  assert.equal((await engine.run("task_31")).status, "completed");
  assert.equal((await engine.run("task_31")).status, "completed");
});

test("32 concurrent execution of one task is rejected by the lease", async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { engine } = fixture({ executeStep: async () => { entered(); await gate; return { ok: true }; } });
  await engine.create({ id: "task_32", steps: [{ id: "only", kind: "task" }] });
  const first = engine.run("task_32");
  await started;
  const second = await engine.run("task_32");
  assert.equal(second.code, "TASK_LEASE_HELD");
  release();
  assert.equal((await first).status, "completed");
});

test("33 unknown external outcome pauses for reconciliation and never blindly retries", async () => {
  let calls = 0;
  const { engine } = fixture({ executeStep: async () => { calls++; throw new Error("connection lost after request"); } });
  await engine.create({ id: "task_33", steps: [{ id: "charge", kind: "task" }] });
  const first = await engine.run("task_33");
  assert.equal(first.status, "paused_reconciliation");
  const second = await engine.run("task_33");
  assert.equal(second.status, "paused_reconciliation");
  assert.equal(calls, 1);
});

test("34 completed ledger result is replayed if checkpoint persistence fails after the effect", async () => {
  const base = createMemoryCheckpointStore();
  let failRevision = true;
  const store = {
    ...base,
    get: (...args) => base.get(...args),
    acquireLease: (...args) => base.acquireLease(...args),
    renewLease: (...args) => base.renewLease(...args),
    releaseLease: (...args) => base.releaseLease(...args),
    claimEffect: (...args) => base.claimEffect(...args),
    completeEffect: (...args) => base.completeEffect(...args),
    getEffect: (...args) => base.getEffect(...args),
    async put(id, state, lease) {
      if (state.revision === 2 && failRevision) { failRevision = false; throw Object.assign(new Error("simulated checkpoint outage"), { code: "CHECKPOINT_WRITE_FAILED" }); }
      return base.put(id, state, lease);
    },
  };
  let calls = 0;
  const { engine } = fixture({ store, executeStep: async () => { calls++; return { receipt: "stored" }; } });
  await engine.create({ id: "task_34", steps: [{ id: "only", kind: "task" }] });
  assert.equal((await engine.run("task_34")).code, "CHECKPOINT_WRITE_FAILED");
  assert.equal((await engine.run("task_34")).status, "completed");
  assert.equal(calls, 1);
});

test("35 rejects an adapter that lacks lease and ledger capabilities", () => {
  assert.throws(() => createDurableExecutionEngine({
    store: { get: async () => null, put: async () => true },
    executeStep: async () => null,
  }), /LEASE_IDEMPOTENCY_CHECKPOINT_STORE_REQUIRED/);
});

test("36 passes an AbortSignal to the step executor", async () => {
  let signal;
  const { engine } = fixture({ executeStep: async context => { signal = context.signal; return { ok: true }; } });
  await engine.create({ id: "task_36", steps: [{ id: "only", kind: "task" }] });
  await engine.run("task_36");
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test("37 refuses to reuse an idempotency key with a different payload", async () => {
  const store = createMemoryCheckpointStore();
  const owner = "owner_token_37_0123456789_abcdefgh";
  const lease = await store.acquireLease("task_37", owner, 5000);
  await store.claimEffect("task_37", owner, lease.fencingToken, "task_37:step", { amount: 1 });
  await assert.rejects(
    () => store.claimEffect("task_37", owner, lease.fencingToken, "task_37:step", { amount: 2 }),
    /IDEMPOTENCY_KEY_CONFLICT/,
  );
});

test("38 rejects checkpoint writes from an expired fencing lease", async () => {
  let clock = 1000;
  const store = createMemoryCheckpointStore({ now: () => clock });
  const ownerA = "owner_token_38_A_0123456789_abcdefgh";
  const ownerB = "owner_token_38_B_0123456789_abcdefgh";
  const leaseA = await store.acquireLease("task_38", ownerA, 5000);
  clock = 7000;
  const leaseB = await store.acquireLease("task_38", ownerB, 5000);
  assert.ok(leaseB.fencingToken > leaseA.fencingToken);
  await assert.rejects(
    () => store.put("task_38", { revision: 0 }, { ownerToken: ownerA, fencingToken: leaseA.fencingToken }),
    /STALE_EXECUTOR/,
  );
});
