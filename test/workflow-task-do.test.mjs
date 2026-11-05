import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowTaskDO } from "../src/durable-objects/workflow-task-do.mjs";
import { createCloudflareCheckpointStore } from "../src/agent/cloudflare-checkpoint-store.mjs";
import { createCloudflareDurableExecutionEngine } from "../src/agent/cloudflare-durable-runtime.mjs";

function makeDO() {
  const data = new Map();
  let transactionTail = Promise.resolve();
  const storage = {
    async get(k) { return data.get(k) ?? null; },
    transaction(fn) {
      const run = transactionTail.then(async () => {
        const staged = new Map(data);
        const txn = {
          get: async k => staged.get(k) ?? null,
          put: async (k,v) => staged.set(k, structuredClone(v)),
          delete: async k => staged.delete(k),
        };
        const result = await fn(txn);
        data.clear(); for (const [k,v] of staged) data.set(k,v);
        return result;
      });
      transactionTail = run.catch(() => {});
      return run;
    },
  };
  const instance = new WorkflowTaskDO({ storage });
  const stub = { fetch: (url, init) => instance.fetch(new Request(url, init)) };
  const namespace = { idFromName: id => id, get: () => stub };
  return { instance, namespace, data, storage };
}
const state = (id, revision, status="ready") => ({version:1,id,revision,status,cursor:0,steps:[{id:"step",kind:"task"}],results:[],completedStepIds:[]});
const OWNER_A = "owner_token_A_0123456789_abcdefgh";
const OWNER_B = "owner_token_B_0123456789_abcdefgh";
async function acquire(instance, id, ownerToken = OWNER_A) {
  const response = await instance.fetch(new Request("https://x/lease/acquire", {
    method: "POST", body: JSON.stringify({ id, ownerToken, leaseMs: 5000 }),
  }));
  return (await response.json()).lease;
}


test("01 reads an absent task as null", async () => { const {namespace}=makeDO(); assert.equal(await createCloudflareCheckpointStore(namespace).get("task_1"),null); });
test("02 atomically creates a checkpoint at revision zero", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); const lease=await store.acquireLease("task_2",OWNER_A,5000); await store.put("task_2",state("task_2",0),{ownerToken:OWNER_A,fencingToken:lease.fencingToken}); assert.equal((await store.get("task_2")).revision,0); });
test("03 rejects a stale checkpoint revision", async () => { const {instance}=makeDO(); const lease=await acquire(instance,"task_3"); await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_3",expectedRevision:-1,state:state("task_3",0),ownerToken:OWNER_A,fencingToken:lease.fencingToken})})); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_3",expectedRevision:-1,state:state("task_3",0,"running"),ownerToken:OWNER_A,fencingToken:lease.fencingToken})})); assert.equal(r.status,409); });
test("04 rejects a skipped revision", async () => { const {instance}=makeDO(); const lease=await acquire(instance,"task_4"); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_4",expectedRevision:0,state:state("task_4",2),ownerToken:OWNER_A,fencingToken:lease.fencingToken})})); assert.equal(r.status,400); });
test("05 rejects task ID mismatch", async () => { const {instance}=makeDO(); const lease=await acquire(instance,"task_5"); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_5",expectedRevision:-1,state:state("other",0),ownerToken:OWNER_A,fencingToken:lease.fencingToken})})); assert.equal(r.status,400); });
test("06 rejects oversized checkpoint bodies", async () => { const {instance}=makeDO(); const big=state("task_6",0); big.payload="x".repeat(26000); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_6",expectedRevision:-1,state:big})})); assert.equal(r.status,413); });
test("07 rejects non-POST methods", async () => { const {instance}=makeDO(); assert.equal((await instance.fetch(new Request("https://x/get"))).status,405); });
test("08 rejects malformed JSON", async () => { const {instance}=makeDO(); assert.equal((await instance.fetch(new Request("https://x/get",{method:"POST",body:"{"})).status,400); });
test("09 rejects unknown storage routes", async () => { const {instance}=makeDO(); assert.equal((await instance.fetch(new Request("https://x/unknown",{method:"POST",body:JSON.stringify({id:"task_9"})})).status,404); });
test("10 adapter writes then reads through the DO namespace", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); const lease=await store.acquireLease("task_10",OWNER_A,5000); await store.put("task_10",state("task_10",0),{ownerToken:OWNER_A,fencingToken:lease.fencingToken}); assert.equal((await store.get("task_10")).status,"ready"); });
test("11 adapter surfaces revision conflicts", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); const lease=await store.acquireLease("task_11",OWNER_A,5000); const auth={ownerToken:OWNER_A,fencingToken:lease.fencingToken}; await store.put("task_11",state("task_11",0),auth); await assert.rejects(()=>store.put("task_11",state("task_11",0,"running"),auth),/CHECKPOINT_CONFLICT/); });
test("12 adapter validates its binding", () => { assert.throws(()=>createCloudflareCheckpointStore(null),/WORKFLOW_TASK_BINDING_REQUIRED/); });
test("13 deletes only the expected revision", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); const lease=await store.acquireLease("task_13",OWNER_A,5000); await store.put("task_13",state("task_13",0),{ownerToken:OWNER_A,fencingToken:lease.fencingToken}); await store.delete("task_13",0,{ownerToken:OWNER_A,fencingToken:lease.fencingToken}); assert.equal(await store.get("task_13"),null); });
test("14 rejects delete with stale revision", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); const lease=await store.acquireLease("task_14",OWNER_A,5000); await store.put("task_14",state("task_14",0),{ownerToken:OWNER_A,fencingToken:lease.fencingToken}); await assert.rejects(()=>store.delete("task_14",1,{ownerToken:OWNER_A,fencingToken:lease.fencingToken}),/CHECKPOINT_CONFLICT/); });

test("15 concurrent writes using one revision allow exactly one winner", async () => { const {instance}=makeDO(); const lease=await acquire(instance,"task_15"); const send=status=>instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_15",expectedRevision:-1,state:state("task_15",0,status),ownerToken:OWNER_A,fencingToken:lease.fencingToken})})); const results=await Promise.all([send("ready"),send("running")]); assert.deepEqual(results.map(r=>r.status).sort(),[200,409]); });
test("16 rejects extra checkpoint envelope fields", async () => { const {instance}=makeDO(); const lease=await acquire(instance,"task_16"); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_16",expectedRevision:-1,state:state("task_16",0),ownerToken:OWNER_A,fencingToken:lease.fencingToken,admin:true})})); assert.equal(r.status,400); });
test("17 rejects extra delete envelope fields", async () => { const {instance}=makeDO(); const r=await instance.fetch(new Request("https://x/delete",{method:"POST",body:JSON.stringify({id:"task_17",expectedRevision:0,force:true})})); assert.equal(r.status,400); });

test("18 grants only one active lease for a task", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("lease_18",OWNER_A,5000);
  assert.equal(lease.fencingToken,1);
  await assert.rejects(()=>store.acquireLease("lease_18",OWNER_B,5000),/TASK_LEASE_HELD/);
});
test("19 renew requires the current owner and fencing token", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("lease_19",OWNER_A,5000);
  const renewed=await store.renewLease("lease_19",OWNER_A,lease.fencingToken,10000);
  assert.ok(renewed.expiresAt>lease.expiresAt);
  await assert.rejects(()=>store.renewLease("lease_19",OWNER_B,lease.fencingToken,5000),/LEASE_NOT_OWNED/);
});
test("20 release requires exact owner and fencing token", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("lease_20",OWNER_A,5000);
  await assert.rejects(()=>store.releaseLease("lease_20",OWNER_B,lease.fencingToken),/LEASE_NOT_OWNED/);
  assert.equal(await store.releaseLease("lease_20",OWNER_A,lease.fencingToken),true);
});
test("21 reacquisition increments the fencing token", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("lease_21",OWNER_A,5000);
  await store.releaseLease("lease_21",OWNER_A,first.fencingToken);
  const second=await store.acquireLease("lease_21",OWNER_B,5000);
  assert.equal(second.fencingToken,first.fencingToken+1);
});
test("22 rejects invalid lease duration and weak owner token", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  await assert.rejects(()=>store.acquireLease("lease_22","weak",1000),/INVALID_LEASE_REQUEST/);
});
test("23 rejects a stale fencing token after lease replacement", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("lease_23",OWNER_A,5000);
  await store.releaseLease("lease_23",OWNER_A,first.fencingToken);
  const second=await store.acquireLease("lease_23",OWNER_B,5000);
  await assert.rejects(()=>store.renewLease("lease_23",OWNER_A,first.fencingToken,5000),/LEASE_NOT_OWNED/);
  assert.ok(second.fencingToken>first.fencingToken);
});

test("24 lease fields cannot weaken checkpoint envelope validation", async () => {
  const {instance}=makeDO();
  const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({
    id:"task_24",expectedRevision:-1,state:state("task_24",0),ownerToken:OWNER_A
  })}));
  assert.equal(r.status,400);
});
test("25 rejects lease renewal with a missing fencing token", async () => {
  const {instance}=makeDO();
  const r=await instance.fetch(new Request("https://x/lease/renew",{method:"POST",body:JSON.stringify({
    id:"task_25",ownerToken:OWNER_A,leaseMs:5000
  })}));
  assert.equal(r.status,400);
});

test("26 checkpoint writes require an active lease", async () => {
  const {instance}=makeDO();
  const response=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({
    id:"task_26",expectedRevision:-1,state:state("task_26",0),ownerToken:OWNER_A,fencingToken:1
  })}));
  assert.equal(response.status,409); assert.equal((await response.json()).code,"STALE_EXECUTOR");
});
test("27 an expired executor cannot write after lease takeover", async () => {
  const {namespace,data}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("task_27",OWNER_A,5000);
  data.set("lease",{...data.get("lease"),expiresAt:Date.now()-1});
  const second=await store.acquireLease("task_27",OWNER_B,5000);
  await assert.rejects(()=>store.put("task_27",state("task_27",0),{ownerToken:OWNER_A,fencingToken:first.fencingToken}),/STALE_EXECUTOR/);
  await store.put("task_27",state("task_27",0),{ownerToken:OWNER_B,fencingToken:second.fencingToken});
});
test("28 completed idempotency effects replay their stored result", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("task_28",OWNER_A,5000);
  const claim=await store.claimEffect("task_28",OWNER_A,lease.fencingToken,"step:alpha",{amount:7});
  assert.equal(claim.replay,false);
  await store.completeEffect("task_28",OWNER_A,lease.fencingToken,"step:alpha",claim.payloadHash,{receipt:"ok"});
  const replay=await store.claimEffect("task_28",OWNER_A,lease.fencingToken,"step:alpha",{amount:7});
  assert.equal(replay.replay,true); assert.deepEqual(replay.result,{receipt:"ok"});
});
test("29 idempotency keys cannot be reused with a different payload", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("task_29",OWNER_A,5000);
  await store.claimEffect("task_29",OWNER_A,lease.fencingToken,"step:alpha",{amount:7});
  await assert.rejects(()=>store.claimEffect("task_29",OWNER_A,lease.fencingToken,"step:alpha",{amount:8}),/IDEMPOTENCY_KEY_CONFLICT/);
});
test("30 an interrupted started effect is never silently executed twice", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("task_30",OWNER_A,5000);
  await store.claimEffect("task_30",OWNER_A,lease.fencingToken,"step:alpha",{send:true});
  await assert.rejects(()=>store.claimEffect("task_30",OWNER_A,lease.fencingToken,"step:alpha",{send:true}),/EFFECT_OUTCOME_UNKNOWN/);
});
test("31 stale fencing tokens cannot claim effects", async () => {
  const {namespace,data}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("task_31",OWNER_A,5000);
  data.set("lease",{...data.get("lease"),expiresAt:Date.now()-1});
  const second=await store.acquireLease("task_31",OWNER_B,5000);
  await assert.rejects(()=>store.claimEffect("task_31",OWNER_A,first.fencingToken,"step:alpha",{x:1}),/STALE_EXECUTOR/);
  assert.ok(second.fencingToken>first.fencingToken);
});
test("32 simultaneous lease acquisition has exactly one winner", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const outcomes=await Promise.allSettled([
    store.acquireLease("task_32",OWNER_A,5000),
    store.acquireLease("task_32",OWNER_B,5000),
  ]);
  assert.equal(outcomes.filter(item=>item.status==="fulfilled").length,1);
  assert.equal(outcomes.filter(item=>item.status==="rejected").length,1);
});
test("33 simultaneous idempotency claims allow one executor", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("task_33",OWNER_A,5000);
  const outcomes=await Promise.allSettled([
    store.claimEffect("task_33",OWNER_A,lease.fencingToken,"step:once",{x:1}),
    store.claimEffect("task_33",OWNER_A,lease.fencingToken,"step:once",{x:1}),
  ]);
  assert.equal(outcomes.filter(item=>item.status==="fulfilled").length,1);
  assert.equal(outcomes.filter(item=>item.status==="rejected").length,1);
});
test("34 stale fencing token cannot complete a claimed effect", async () => {
  const {namespace,data}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("task_34",OWNER_A,5000);
  const claim=await store.claimEffect("task_34",OWNER_A,first.fencingToken,"step:once",{x:1});
  data.set("lease",{...data.get("lease"),expiresAt:Date.now()-1});
  await store.acquireLease("task_34",OWNER_B,5000);
  await assert.rejects(()=>store.completeEffect("task_34",OWNER_A,first.fencingToken,"step:once",claim.payloadHash,{ok:true}),/STALE_EXECUTOR/);
});

test("35 recovery inspection exposes an interrupted effect without retrying it", async () => {
  const {namespace,data}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("task_35",OWNER_A,5000);
  await store.claimEffect("task_35",OWNER_A,first.fencingToken,"step:uncertain",{send:true});
  data.set("lease",{...data.get("lease"),expiresAt:Date.now()-1});
  const recovered=await store.acquireLease("task_35",OWNER_B,5000);
  const effect=await store.getEffect("task_35",OWNER_B,recovered.fencingToken,"step:uncertain");
  assert.equal(effect.status,"started");
  await assert.rejects(()=>store.claimEffect("task_35",OWNER_B,recovered.fencingToken,"step:uncertain",{send:true}),/EFFECT_OUTCOME_UNKNOWN/);
});
test("36 completed effects remain replayable after lease recovery", async () => {
  const {namespace,data}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("task_36",OWNER_A,5000);
  const claim=await store.claimEffect("task_36",OWNER_A,first.fencingToken,"step:done",{x:1});
  await store.completeEffect("task_36",OWNER_A,first.fencingToken,"step:done",claim.payloadHash,{ok:true});
  data.set("lease",{...data.get("lease"),expiresAt:Date.now()-1});
  const second=await store.acquireLease("task_36",OWNER_B,5000);
  const replay=await store.claimEffect("task_36",OWNER_B,second.fencingToken,"step:done",{x:1});
  assert.equal(replay.replay,true); assert.deepEqual(replay.result,{ok:true});
});
test("37 the per-task idempotency ledger has a hard entry limit", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("task_37",OWNER_A,5000);
  for(let i=0;i<128;i++) await store.claimEffect("task_37",OWNER_A,lease.fencingToken,"effect_"+i,{i});
  await assert.rejects(()=>store.claimEffect("task_37",OWNER_A,lease.fencingToken,"effect_overflow",{x:1}),/EFFECT_LEDGER_LIMIT/);
});
test("38 stale executors cannot inspect the effect ledger", async () => {
  const {namespace,data}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const first=await store.acquireLease("task_38",OWNER_A,5000);
  await store.claimEffect("task_38",OWNER_A,first.fencingToken,"step:inspect",{x:1});
  data.set("lease",{...data.get("lease"),expiresAt:Date.now()-1});
  await store.acquireLease("task_38",OWNER_B,5000);
  await assert.rejects(()=>store.getEffect("task_38",OWNER_A,first.fencingToken,"step:inspect"),/STALE_EXECUTOR/);
});

test("39 idempotency payload hashing is independent of object key order", async () => {
  const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace);
  const lease=await store.acquireLease("task_39",OWNER_A,5000);
  const claim=await store.claimEffect("task_39",OWNER_A,lease.fencingToken,"step:canonical",{a:1,b:2});
  await store.completeEffect("task_39",OWNER_A,lease.fencingToken,"step:canonical",claim.payloadHash,{ok:true});
  const replay=await store.claimEffect("task_39",OWNER_A,lease.fencingToken,"step:canonical",{b:2,a:1});
  assert.equal(replay.replay,true);
});


test("40 checkpoint survives Durable Object instance recreation and resumes with a higher fence", async () => {
  const { namespace, data, storage } = makeDO();
  const firstStore = createCloudflareCheckpointStore(namespace);
  const firstLease = await firstStore.acquireLease("task_eviction", OWNER_A, 5000);
  await firstStore.put("task_eviction", {
    version: 1, id: "task_eviction", revision: 0, status: "running",
    cursor: 1, steps: [{ id: "step", kind: "task" }],
    results: [{ stepId: "step", value: { checkpoint: "persisted" } }],
    completedStepIds: ["step"],
  }, { ownerToken: OWNER_A, fencingToken: firstLease.fencingToken });

  // Simulate a Durable Object eviction/re-instantiation while retaining durable storage.
  const restarted = new WorkflowTaskDO({ storage });
  const restartedNamespace = {
    idFromName: id => id,
    get: () => ({ fetch: (url, init) => restarted.fetch(new Request(url, init)) }),
  };
  const recoveredStore = createCloudflareCheckpointStore(restartedNamespace);
  const recovered = await recoveredStore.get("task_eviction");
  assert.equal(recovered.revision, 0);
  assert.deepEqual(recovered.results[0].value, { checkpoint: "persisted" });

  data.set("lease", { ...data.get("lease"), expiresAt: Date.now() - 1 });
  const nextLease = await recoveredStore.acquireLease("task_eviction", OWNER_B, 5000);
  assert.equal(nextLease.fencingToken, firstLease.fencingToken + 1);
  await assert.rejects(
    () => recoveredStore.put("task_eviction", { ...recovered, revision: 1 }, {
      ownerToken: OWNER_A, fencingToken: firstLease.fencingToken,
    }),
    /STALE_EXECUTOR/,
  );
});


test("41 durable engine executes through Durable Object lease, fenced checkpoint and idempotency ledger", async () => {
  const { namespace } = makeDO();
  const calls = [];
  const engine = createCloudflareDurableExecutionEngine({
    env: { WORKFLOW_TASKS: namespace },
    executeStep: async context => {
      calls.push(context);
      return { completed: context.stepId, idempotencyKey: context.idempotencyKey };
    },
  });
  const created = await engine.create({
    id: "task_41",
    input: { goal: "integration" },
    steps: [{ id: "only", kind: "task" }],
  });
  assert.equal(created.ok, true);
  const completed = await engine.run("task_41");
  assert.equal(completed.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, "task_41:only");
  const recovered = await engine.get("task_41");
  assert.equal(recovered.state.status, "completed");
  assert.equal(recovered.state.completedStepIds[0], "only");
});
