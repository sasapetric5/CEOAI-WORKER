import test from "node:test";
import assert from "node:assert/strict";
import {createToolRegistry,createToolSession} from "../src/agent/tool-registry.mjs";

const schema={type:"object",properties:{value:{type:"string",maxLength:8},amount:{type:"number",minimum:0,maximum:10}},required:["value"],additionalProperties:false};
const definition=(overrides={})=>({id:"safe_read",description:"Safe read operation",inputSchema:schema,handler:async input=>({received:input}),...overrides});
const registry=(options={})=>createToolRegistry({enabled:true,tools:[definition()],...options});
const context=(session,overrides={})=>({allowToolExecution:true,allowedToolIds:["safe_read"],session,...overrides});

const cases=[
 ["registry is inactive unless enabled is exactly true",async()=>{
  const r=createToolRegistry({enabled:"true",tools:[definition()]});
  assert.equal((await r.execute("safe_read",{value:"ok"},context(createToolSession()))).code,"TOOLS_DISABLED");
 }],
 ["reserved tool identifiers are rejected",async()=>{
  assert.throws(()=>createToolRegistry({tools:[definition({id:"__proto__"})]}),/INVALID_TOOL_ID/);
 }],
 ["duplicate tool identifiers are rejected",async()=>{
  assert.throws(()=>createToolRegistry({tools:[definition(),definition()]}),/DUPLICATE_TOOL/);
 }],
 ["blank descriptions are rejected",async()=>{
  assert.throws(()=>createToolRegistry({tools:[definition({description:"  "})]}),/INVALID_TOOL_DESCRIPTION/);
 }],
 ["oversized descriptions are rejected",async()=>{
  assert.throws(()=>createToolRegistry({tools:[definition({description:"x".repeat(241)})]}),/INVALID_TOOL_DESCRIPTION/);
 }],
 ["unknown schema keywords are rejected",async()=>{
  assert.throws(()=>createToolRegistry({tools:[definition({inputSchema:{...schema,patternProperties:{}}})]}),/INVALID_TOOL_SCHEMA/);
 }],
 ["additional properties must be disabled",async()=>{
  assert.throws(()=>createToolRegistry({tools:[definition({inputSchema:{...schema,additionalProperties:true}})]}),/INVALID_TOOL_SCHEMA/);
 }],
 ["oversized property sets are rejected",async()=>{
  const properties=Object.fromEntries(Array.from({length:33},(_,i)=>["field_"+i,{type:"string"}]));
  assert.throws(()=>createToolRegistry({tools:[definition({inputSchema:{type:"object",properties,additionalProperties:false}})]}),/INVALID_TOOL_SCHEMA/);
 }],
 ["invalid tool limits are rejected",async()=>{
  assert.throws(()=>createToolRegistry({limits:{timeoutMs:0},tools:[definition()]}),/INVALID_LIMIT/);
 }],
 ["unknown tool limit names are rejected",async()=>{
  assert.throws(()=>createToolRegistry({limits:{unbounded:true},tools:[definition()]}),/INVALID_LIMIT/);
 }],
 ["tool sessions reject zero calls",async()=>{
  assert.throws(()=>createToolSession({maxCalls:0}),/INVALID_TOOL_SESSION_LIMIT/);
 }],
 ["tool sessions reject excessive calls",async()=>{
  assert.throws(()=>createToolSession({maxCalls:9}),/INVALID_TOOL_SESSION_LIMIT/);
 }],
 ["symbol-keyed arguments are rejected",async()=>{
  const input={value:"ok"};input[Symbol("hidden")]=true;
  assert.equal(registry().validate("safe_read",input).code,"UNKNOWN_ARGUMENT");
 }],
 ["custom-prototype argument objects are rejected",async()=>{
  const input=Object.assign(Object.create({inherited:true}),{value:"ok"});
  assert.equal(registry().validate("safe_read",input).code,"INVALID_ARGUMENTS");
 }],
 ["non-finite numeric arguments are rejected",async()=>{
  assert.equal(registry().validate("safe_read",{value:"ok",amount:Infinity}).code,"INVALID_ARGUMENT_TYPE");
 }],
 ["null-prototype argument objects are safely accepted",async()=>{
  const input=Object.assign(Object.create(null),{value:"ok"});
  assert.equal(registry().validate("safe_read",input).ok,true);
 }],
 ["public schema copies cannot mutate private validation rules",async()=>{
  const r=registry(),published=r.get("safe_read");
  published.inputSchema.properties.value.maxLength=1000;
  assert.equal(r.validate("safe_read",{value:"x".repeat(9)}).code,"INVALID_ARGUMENT_TYPE");
 }],
 ["accessor-backed approval flags fail closed",async()=>{
  const r=registry(),s=createToolSession(),ctx=context(s);
  Object.defineProperty(ctx,"allowToolExecution",{enumerable:true,get(){throw Error("must not execute");}});
  assert.equal((await r.execute("safe_read",{value:"ok"},ctx)).code,"EXECUTION_NOT_APPROVED");
 }],
 ["accessor-backed capability grants fail closed",async()=>{
  const r=registry(),s=createToolSession(),ctx={allowToolExecution:true,session:s};
  Object.defineProperty(ctx,"allowedToolIds",{enumerable:true,get(){throw Error("must not execute");}});
  assert.equal((await r.execute("safe_read",{value:"ok"},ctx)).code,"TOOL_CAPABILITY_DENIED");
 }],
 ["accessor-backed sessions fail closed",async()=>{
  const r=registry(),ctx={allowToolExecution:true,allowedToolIds:["safe_read"]};
  Object.defineProperty(ctx,"session",{enumerable:true,get(){throw Error("must not execute");}});
  assert.equal((await r.execute("safe_read",{value:"ok"},ctx)).code,"INVALID_TOOL_SESSION");
 }],
 ["failed handlers still consume the bounded session call",async()=>{
  const r=createToolRegistry({enabled:true,tools:[definition({handler:async()=>{throw Error("failure");}})]});
  const s=createToolSession({maxCalls:1}),ctx=context(s);
  assert.equal((await r.execute("safe_read",{value:"ok"},ctx)).code,"TOOL_EXECUTION_FAILED");
  assert.equal((await r.execute("safe_read",{value:"ok"},ctx)).code,"TOOL_SESSION_CALL_LIMIT");
 }]
];
for(const [name,fn] of cases)test("tool registry hardening: "+name,fn);
