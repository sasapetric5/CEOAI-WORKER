import test from "node:test";
import assert from "node:assert/strict";
import {publishSkillCatalogToKV,createKVSkillRegistry} from "../src/agent/skill-storage.mjs";

const toolRegistry={get:id=>["lookup","crawl","write"].includes(id)?{id}:null};
const skill=(id,content="safe skill instructions")=>({
 id,version:"1.0.0",description:`${id} skill`,allowedToolIds:[],tags:[id.startsWith("seo")?"seo":"earn"],keywords:[id.split("_")[0]],content
});
function memoryKV(){
 const data=new Map();
 return {data,async put(key,value){data.set(key,value);},async get(key){return data.get(key)??null;}};
}

test("newly published skills default to quarantine and stay out of runtime discovery",async()=>{
 const kv=memoryKV();
 const published=await publishSkillCatalogToKV({kv,skills:[skill("seo_audit")],toolRegistry});
 assert.equal(published.quarantinedCount,1);
 const registry=await createKVSkillRegistry({kv,toolRegistry});
 assert.equal(registry.size,0);
 assert.deepEqual(registry.search("seo"),[]);
});

test("only separately code-approved skill IDs enter the runtime registry",async()=>{
 const kv=memoryKV();
 await publishSkillCatalogToKV({kv,skills:[skill("seo_audit"),skill("earn_proposal")],toolRegistry,approvedSkillIds:["seo_audit"]});
 const registry=await createKVSkillRegistry({kv,toolRegistry,approvedSkillIds:["seo_audit"]});
 assert.equal(registry.size,1);
 assert.ok(registry.get("seo_audit"));
 assert.equal(registry.get("earn_proposal"),null);
});

test("forged KV approval metadata cannot bypass the code-owned approval list",async()=>{
 const kv=memoryKV();
 await publishSkillCatalogToKV({kv,skills:[skill("seo_audit")],toolRegistry});
 const index=JSON.parse(kv.data.get("skills:v1:index"));
 index.skills[0].approvalStatus="approved";
 kv.data.set("skills:v1:index",JSON.stringify(index));
 const registry=await createKVSkillRegistry({kv,toolRegistry});
 assert.equal(registry.size,0);
});

test("category capability policy is an upper bound on per-skill tools",async()=>{
 const kv=memoryKV();
 await publishSkillCatalogToKV({kv,skills:[skill("seo_audit")],toolRegistry,approvedSkillIds:["seo_audit"]});
 const registry=await createKVSkillRegistry({
  kv,toolRegistry,approvedSkillIds:["seo_audit"],
  capabilityPolicy:{seo_audit:["lookup","crawl"]},
  categoryBySkillId:{seo_audit:"seo"},
  categoryCapabilityPolicy:{seo:["lookup"]}
 });
 assert.deepEqual(registry.get("seo_audit").allowedToolIds,["lookup"]);
 assert.equal(registry.allows("seo_audit","crawl"),false);
});

test("unknown or missing category grants no tools",async()=>{
 const kv=memoryKV();
 await publishSkillCatalogToKV({kv,skills:[skill("seo_audit")],toolRegistry,approvedSkillIds:["seo_audit"]});
 const registry=await createKVSkillRegistry({
  kv,toolRegistry,approvedSkillIds:["seo_audit"],
  capabilityPolicy:{seo_audit:["lookup"]},
  categoryBySkillId:{seo_audit:"unclassified"},
  categoryCapabilityPolicy:{seo:["lookup"]}
 });
 assert.deepEqual(registry.get("seo_audit").allowedToolIds,[]);
});

test("legacy index without approval status remains quarantined by default",async()=>{
 const kv=memoryKV();
 await publishSkillCatalogToKV({kv,skills:[skill("seo_audit")],toolRegistry});
 const index=JSON.parse(kv.data.get("skills:v1:index"));
 delete index.skills[0].approvalStatus;
 kv.data.set("skills:v1:index",JSON.stringify(index));
 const registry=await createKVSkillRegistry({kv,toolRegistry});
 assert.equal(registry.size,0);
});

test("invalid approval status and unknown approval IDs are rejected",async()=>{
 const kv=memoryKV();
 await publishSkillCatalogToKV({kv,skills:[skill("seo_audit")],toolRegistry});
 const index=JSON.parse(kv.data.get("skills:v1:index"));
 index.skills[0].approvalStatus="trusted";
 kv.data.set("skills:v1:index",JSON.stringify(index));
 await assert.rejects(()=>createKVSkillRegistry({kv,toolRegistry}),/SKILL_INDEX_INVALID_APPROVAL_STATUS/);
 await assert.rejects(()=>createKVSkillRegistry({kv,toolRegistry,approvedSkillIds:["missing_skill"]}),/INVALID_APPROVED_SKILL_IDS/);
});
