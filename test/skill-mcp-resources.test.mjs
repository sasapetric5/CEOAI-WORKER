import test from "node:test";
import assert from "node:assert/strict";
import {createSkillMCPResources} from "../src/agent/skill-mcp-resources.mjs";
const entries=[{id:"alpha_skill",description:"Alpha",content:"alpha reference"},{id:"beta_skill",description:"Beta",content:"beta reference"}];
const registry={list:()=>entries.map(({id,description})=>({id,description})),load:async id=>{const e=entries.find(x=>x.id===id);return e?{...e}:null;}};
test("MCP resource adapter requires an authorizer",()=>assert.throws(()=>createSkillMCPResources({skillRegistry:registry}),/MCP_AUTHORIZER_REQUIRED/));
test("MCP list exposes bounded metadata only and requires authorization",async()=>{
 const gateway=createSkillMCPResources({skillRegistry:registry,authorize:async ctx=>ctx?.authenticated===true,maxPageSize:1});
 assert.equal((await gateway.handle({method:"resources/list"})).error.code,"ACCESS_DENIED");
 const page=await gateway.handle({method:"resources/list",authContext:{authenticated:true}});
 assert.equal(page.resources.length,1);assert.equal(page.resources[0].uri,"ceoai://skills/alpha_skill");assert.equal(page.nextCursor,"1");
 assert.equal(Object.hasOwn(page.resources[0],"content"),false);
 const second=await gateway.handle({method:"resources/list",params:{cursor:page.nextCursor},authContext:{authenticated:true}});
 assert.equal(second.resources[0].name,"beta_skill");assert.equal(second.nextCursor,undefined);
});
test("MCP reads only exact skill resource URIs",async()=>{
 const gateway=createSkillMCPResources({skillRegistry:registry,authorize:async()=>true});
 const result=await gateway.handle({method:"resources/read",params:{uri:"ceoai://skills/alpha_skill"}});
 assert.equal(result.contents[0].text,"alpha reference");
 assert.equal((await gateway.handle({method:"resources/read",params:{uri:"file:///etc/passwd"}})).error.code,"INVALID_RESOURCE_URI");
 assert.equal((await gateway.handle({method:"resources/read",params:{uri:"ceoai://skills/missing"}})).error.code,"RESOURCE_NOT_FOUND");
});
test("MCP adapter exposes no write or tool methods",async()=>{
 const gateway=createSkillMCPResources({skillRegistry:registry,authorize:async()=>true});
 assert.equal((await gateway.handle({method:"tools/call",params:{name:"anything"}})).error.code,"METHOD_NOT_FOUND");
 assert.equal((await gateway.handle({method:"resources/write"})).error.code,"METHOD_NOT_FOUND");
});

test("MCP resource adapter rejects accessor and unknown parameters without invoking getters",async()=>{
 const gateway=createSkillMCPResources({skillRegistry:registry,authorize:async()=>true});
 let getterCalls=0;
 const params={};
 Object.defineProperty(params,"uri",{enumerable:true,get(){getterCalls++;return "ceoai://skills/alpha_skill";}});
 const result=await gateway.handle({method:"resources/read",params});
 assert.equal(result.error.code,"INVALID_PARAMS");
 assert.equal(getterCalls,0);
 const unknown=await gateway.handle({method:"resources/read",params:{uri:"ceoai://skills/alpha_skill",path:"/etc/passwd"}});
 assert.equal(unknown.error.code,"INVALID_PARAMS");
});
