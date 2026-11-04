import test from "node:test";
import assert from "node:assert/strict";
import {runConfiguredProviderCompletion,runCEOAIInternalAgentTask} from "../ceoai-index-v5.0.mjs";
const noProviders={AI_ENABLED:"true",KV_MEMORY:{async get(){return null;},async put(){}}};
test("internal provider completion fails closed when AI is disabled",async()=>{
 const result=await runConfiguredProviderCompletion({AI_ENABLED:"false"},[{role:"user",content:"hello"}]);
 assert.deepEqual(result,{ok:false,code:"AI_DISABLED"});
});
test("internal provider completion reports no configured provider without making a paid call",async()=>{
 const result=await runConfiguredProviderCompletion(noProviders,[{role:"user",content:"hello"}],"reasoning");
 assert.deepEqual(result,{ok:false,code:"NO_PROVIDER_CONFIGURED"});
});
test("internal agent task requires explicit approval and AI enablement",async()=>{
 const system={multiAgentSupervisor:{run:async()=>({ok:true})}};
 assert.equal((await runCEOAIInternalAgentTask(noProviders,{system,task:"review"})).code,"EXECUTION_NOT_APPROVED");
 assert.equal((await runCEOAIInternalAgentTask({...noProviders,AI_ENABLED:"false"},{system,task:"review",allowToolExecution:true})).code,"AI_DISABLED");
});
test("internal agent task does not silently expose a new HTTP route",async()=>{
 const source=(await import("node:fs/promises")).readFile(new URL("../ceoai-index-v5.0.mjs",import.meta.url),"utf8");
 const code=await source;
 assert.equal(code.includes('url.pathname === "/api/agents/run"'),false);
});
