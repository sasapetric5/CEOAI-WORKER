import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowTaskDO } from "../src/durable-objects/workflow-task-do.mjs";
import { createCloudflareCheckpointStore } from "../src/agent/cloudflare-checkpoint-store.mjs";

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
  return { instance, namespace, data };
}
const state = (id, revision, status="ready") => ({version:1,id,revision,status,cursor:0,steps:[{id:"step",kind:"task"}],results:[],completedStepIds:[]});

test("01 reads an absent task as null", async () => { const {namespace}=makeDO(); assert.equal(await createCloudflareCheckpointStore(namespace).get("task_1"),null); });
test("02 atomically creates a checkpoint at revision zero", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); await store.put("task_2",state("task_2",0)); assert.equal((await store.get("task_2")).revision,0); });
test("03 rejects a stale checkpoint revision", async () => { const {instance}=makeDO(); await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_3",expectedRevision:-1,state:state("task_3",0)})})); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_3",expectedRevision:-1,state:state("task_3",0,"running")})})); assert.equal(r.status,409); });
test("04 rejects a skipped revision", async () => { const {instance}=makeDO(); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_4",expectedRevision:0,state:state("task_4",2)})})); assert.equal(r.status,400); });
test("05 rejects task ID mismatch", async () => { const {instance}=makeDO(); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_5",expectedRevision:-1,state:state("other",0)})})); assert.equal(r.status,400); });
test("06 rejects oversized checkpoint bodies", async () => { const {instance}=makeDO(); const big=state("task_6",0); big.payload="x".repeat(26000); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_6",expectedRevision:-1,state:big})})); assert.equal(r.status,413); });
test("07 rejects non-POST methods", async () => { const {instance}=makeDO(); assert.equal((await instance.fetch(new Request("https://x/get"))).status,405); });
test("08 rejects malformed JSON", async () => { const {instance}=makeDO(); assert.equal((await instance.fetch(new Request("https://x/get",{method:"POST",body:"{"})).status,400); });
test("09 rejects unknown storage routes", async () => { const {instance}=makeDO(); assert.equal((await instance.fetch(new Request("https://x/unknown",{method:"POST",body:JSON.stringify({id:"task_9"})})).status,404); });
test("10 adapter writes then reads through the DO namespace", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); await store.put("task_10",state("task_10",0)); assert.equal((await store.get("task_10")).status,"ready"); });
test("11 adapter surfaces revision conflicts", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); await store.put("task_11",state("task_11",0)); await assert.rejects(()=>store.put("task_11",state("task_11",0,"running")),/CHECKPOINT_CONFLICT/); });
test("12 adapter validates its binding", () => { assert.throws(()=>createCloudflareCheckpointStore(null),/WORKFLOW_TASK_BINDING_REQUIRED/); });
test("13 deletes only the expected revision", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); await store.put("task_13",state("task_13",0)); await store.delete("task_13",0); assert.equal(await store.get("task_13"),null); });
test("14 rejects delete with stale revision", async () => { const {namespace}=makeDO(); const store=createCloudflareCheckpointStore(namespace); await store.put("task_14",state("task_14",0)); await assert.rejects(()=>store.delete("task_14",1),/CHECKPOINT_CONFLICT/); });

test("15 concurrent writes using one revision allow exactly one winner", async () => { const {instance}=makeDO(); const send=status=>instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_15",expectedRevision:-1,state:state("task_15",0,status)})})); const results=await Promise.all([send("ready"),send("running")]); assert.deepEqual(results.map(r=>r.status).sort(),[200,409]); });
test("16 rejects extra checkpoint envelope fields", async () => { const {instance}=makeDO(); const r=await instance.fetch(new Request("https://x/put",{method:"POST",body:JSON.stringify({id:"task_16",expectedRevision:-1,state:state("task_16",0),admin:true})})); assert.equal(r.status,400); });
test("17 rejects extra delete envelope fields", async () => { const {instance}=makeDO(); const r=await instance.fetch(new Request("https://x/delete",{method:"POST",body:JSON.stringify({id:"task_17",expectedRevision:0,force:true})})); assert.equal(r.status,400); });

const OWNER_A = "owner_token_A_0123456789_abcdefgh";
const OWNER_B = "owner_token_B_0123456789_abcdefgh";
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
