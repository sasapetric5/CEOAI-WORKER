import test from "node:test";
import assert from "node:assert/strict";
import { compileWorkflowGraph, createAdvancedOrchestrator } from "../src/agent/advanced-orchestrator.mjs";

const node = (id, dependsOn = [], extra = {}) => ({ id, agentId: "agent_main", skillIds: ["skill_base"], capabilities: ["general"], dependsOn, ...extra });
const graph = nodes => compileWorkflowGraph({ id: "flow_01", nodes });
test("01 compiles a single-node workflow", () => { const r=graph([node("start")]); assert.equal(r.ok,true); assert.deepEqual(r.graph.waves,[["start"]]); });
test("02 rejects invalid workflow IDs", () => { assert.equal(compileWorkflowGraph({id:"../x",nodes:[node("a")]}).code,"INVALID_WORKFLOW_ID"); });
test("03 rejects empty graphs", () => { assert.equal(graph([]).code,"INVALID_WORKFLOW_NODES"); });
test("04 rejects duplicate node IDs", () => { assert.equal(graph([node("a"),node("a")]).code,"DUPLICATE_NODE_ID"); });
test("05 rejects unknown dependencies", () => { assert.equal(graph([node("a",["missing"])]).code,"UNKNOWN_DEPENDENCY"); });
test("06 rejects dependency cycles", () => { assert.equal(graph([node("a",["b"]),node("b",["a"])]).code,"WORKFLOW_CYCLE"); });
test("07 creates deterministic topological waves", () => { const r=graph([node("c",["a","b"]),node("a"),node("b")]); assert.deepEqual(r.graph.waves,[["a","b"],["c"]]); });
test("08 rejects unsupported capability names", () => { assert.equal(graph([node("a",[],{capabilities:["root"]})]).code,"INVALID_WORKFLOW_NODES"); });
test("09 rejects invalid agent IDs", () => { assert.equal(graph([node("a",[],{agentId:"../agent"})]).code,"INVALID_WORKFLOW_NODES"); });
test("10 rejects duplicate skill IDs", () => { assert.equal(graph([node("a",[],{skillIds:["skill_a","skill_a"]})]).code,"INVALID_WORKFLOW_NODES"); });
test("11 rejects duplicate dependencies", () => { assert.equal(graph([node("a"),node("b",["a","a"])]).code,"INVALID_WORKFLOW_NODES"); });
test("12 rejects oversized node input", () => { assert.equal(graph([node("a",[],{input:{text:"x".repeat(9000)}})]).code,"INVALID_WORKFLOW_NODES"); });
test("13 rejects unknown node fields", () => { assert.equal(graph([node("a",[],{shell:true})]).code,"INVALID_WORKFLOW_NODES"); });
test("14 rejects more than the node limit", () => { const nodes=Array.from({length:65},(_,i)=>node("n"+i)); assert.equal(graph(nodes).code,"INVALID_WORKFLOW_NODES"); });
test("15 executes independent nodes in parallel and joins dependents", async () => {
  const seen=[]; const r=graph([node("join",["a","b"]),node("a"),node("b")]);
  const runner=createAdvancedOrchestrator({executeNode:async ({nodeId})=>{seen.push(nodeId);return {done:nodeId};},maxParallel:2});
  const out=await runner.run(r.graph,{grantedCapabilities:["general"]});
  assert.equal(out.status,"completed"); assert.deepEqual(out.results.join,{done:"join"}); assert.equal(seen.length,3);
});
test("16 blocks a node without its capability grant", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>({ok:true})});
  const out=await runner.run(graph([node("seo",[],{capabilities:["seo"]})]).graph,{grantedCapabilities:["general"]});
  assert.equal(out.code,"CAPABILITY_NOT_GRANTED");
});
test("17 pauses before an approval-required node", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>({ok:true})});
  const out=await runner.run(graph([node("approve",[],{requiresApproval:true})]).graph,{grantedCapabilities:["general"]});
  assert.equal(out.status,"paused_approval"); assert.equal(out.pendingNodeId,"approve");
});
test("18 restores prior node results without re-executing them", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async()=>{calls++;return 2;}});
  const out=await runner.run(graph([node("a"),node("b",["a"])]).graph,{grantedCapabilities:["general"],priorResults:{a:1}});
  assert.equal(out.status,"completed"); assert.equal(calls,1);
});
test("19 checkpoints completed nodes", async () => {
  const saved=[]; const runner=createAdvancedOrchestrator({executeNode:async()=>1,checkpoint:async state=>saved.push(state)});
  await runner.run(graph([node("a"),node("b")]).graph,{grantedCapabilities:["general"]});
  assert.equal(saved.length,2);
});
test("20 rejects invalid parallel limits", () => { assert.throws(()=>createAdvancedOrchestrator({executeNode:async()=>1,maxParallel:99}),/INVALID_PARALLEL_LIMIT/); });
test("21 rejects invalid capability grant values", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>1});
  assert.equal((await runner.run(graph([node("a")]).graph,{grantedCapabilities:["admin"]})).code,"INVALID_CAPABILITY_GRANTS");
});
test("22 rejects malformed prior result snapshots", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>1});
  assert.equal((await runner.run(graph([node("a")]).graph,{priorResults:"bad"})).code,"INVALID_PRIOR_RESULTS");
});
test("23 rejects a corrupted compiled graph", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>1});
  assert.equal((await runner.run({version:1,id:"flow_01",nodes:[],waves:[["missing"]]},{grantedCapabilities:["general"]})).code,"INVALID_COMPILED_GRAPH");
});
test("24 stops downstream waves after a node failure", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async ({nodeId})=>{calls++;if(nodeId==="a")throw Error("fail");return 1;}});
  const out=await runner.run(graph([node("a"),node("b",["a"])]).graph,{grantedCapabilities:["general"]});
  assert.equal(out.status,"failed"); assert.equal(calls,1);
});
test("25 rejects invalid node result values", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>undefined});
  const out=await runner.run(graph([node("a")]).graph,{grantedCapabilities:["general"]});
  assert.equal(out.status,"failed");
});
test("26 records node completion through the audit hook", async () => {
  const events=[]; const runner=createAdvancedOrchestrator({executeNode:async()=>1,audit:{record:e=>events.push(e)}});
  await runner.run(graph([node("a")]).graph,{grantedCapabilities:["general"]});
  assert.equal(events[0].type,"node_completed");
});

test("27 rejects an omitted wave and cannot report false completion", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async()=>{calls++;return 1;}});
  const compiled=graph([node("a")]).graph;
  const out=await runner.run({...compiled,waves:[]},{grantedCapabilities:["general"]});
  assert.equal(out.code,"INVALID_COMPILED_GRAPH"); assert.equal(calls,0);
});
test("28 rejects a duplicated node across waves", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async()=>{calls++;return 1;}});
  const compiled=graph([node("a"),node("b",["a"])]).graph;
  const out=await runner.run({...compiled,waves:[["a"],["a","b"]]},{grantedCapabilities:["general"]});
  assert.equal(out.code,"INVALID_COMPILED_GRAPH"); assert.equal(calls,0);
});
test("29 rejects a node omitted from all waves", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async()=>{calls++;return 1;}});
  const compiled=graph([node("a"),node("b")]).graph;
  const out=await runner.run({...compiled,waves:[["a"]]},{grantedCapabilities:["general"]});
  assert.equal(out.code,"INVALID_COMPILED_GRAPH"); assert.equal(calls,0);
});
test("30 rejects reordered non-canonical waves", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async()=>{calls++;return 1;}});
  const compiled=graph([node("a"),node("b",["a"])]).graph;
  const out=await runner.run({...compiled,waves:[["b"],["a"]]},{grantedCapabilities:["general"]});
  assert.equal(out.code,"INVALID_COMPILED_GRAPH"); assert.equal(calls,0);
});
test("31 rejects extra compiled graph fields", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>1});
  const out=await runner.run({...graph([node("a")]).graph,admin:true},{grantedCapabilities:["general"]});
  assert.equal(out.code,"INVALID_COMPILED_GRAPH");
});
test("32 rejects restored results whose dependencies are missing", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async()=>{calls++;return 1;}});
  const out=await runner.run(graph([node("a"),node("b",["a"])]).graph,{grantedCapabilities:["general"],priorResults:{b:2}});
  assert.equal(out.code,"INVALID_PRIOR_RESULT_DEPENDENCIES"); assert.equal(calls,0);
});
test("33 accepts a canonical compiled graph with normalized null input", async () => {
  const runner=createAdvancedOrchestrator({executeNode:async()=>({ok:true})});
  const out=await runner.run(graph([node("a")]).graph,{grantedCapabilities:["general"]});
  assert.equal(out.status,"completed");
});
test("34 rejects duplicate wave membership before any execution", async () => {
  let calls=0; const runner=createAdvancedOrchestrator({executeNode:async()=>{calls++;return 1;}});
  const compiled=graph([node("a"),node("b")]).graph;
  const out=await runner.run({...compiled,waves:[["a","b"],["b"]]},{grantedCapabilities:["general"]});
  assert.equal(out.code,"INVALID_COMPILED_GRAPH"); assert.equal(calls,0);
});
