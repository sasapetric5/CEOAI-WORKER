// CEOAI Test Registry: append-only evidence ledger. Pass status requires verified CI evidence.
const ID=/^[a-z][a-z0-9_-]{0,95}$/;
const SHA=/^[a-f0-9]{40,64}$/;
const RUN=/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[0-9]+$/;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const STATUSES=new Set(["candidate","license_verified","compatibility_reviewed","adapted","executed_pass","executed_fail","quarantined"]);
const MAX_RECORDS=10000;
const MAX_BYTES=16384;
const clone=v=>JSON.parse(JSON.stringify(v));
function validBase(record){
 return plain(record)&&Object.keys(record).every(k=>["id","title","category","sourceProject","sourceRepository","sourcePath","sourceCommit","license","licenseDecision","adapterPath","status","tags"].includes(k))&&
 typeof record.id==="string"&&ID.test(record.id)&&typeof record.title==="string"&&record.title.trim().length>0&&record.title.length<=180&&
 typeof record.category==="string"&&ID.test(record.category)&&typeof record.sourceProject==="string"&&record.sourceProject.length<=100&&
 typeof record.sourceRepository==="string"&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.sourceRepository)&&
 (record.sourcePath===null||(typeof record.sourcePath==="string"&&record.sourcePath.length<=512))&&
 (record.sourceCommit===null||SHA.test(record.sourceCommit))&&typeof record.license==="string"&&record.license.length<=160&&
 ["pending","approved","restricted","rejected"].includes(record.licenseDecision)&&
 (record.adapterPath===null||(typeof record.adapterPath==="string"&&record.adapterPath.length<=512))&&STATUSES.has(record.status)&&
 Array.isArray(record.tags)&&record.tags.length<=24&&record.tags.every(t=>typeof t==="string"&&t.length<=32);
}
function validEvidence(e){
 return plain(e)&&Object.keys(e).every(k=>["commitSha","workflowRunUrl","command","runtime","startedAt","completedAt","exitCode","result","signature"].includes(k))&&
 SHA.test(e.commitSha)&&typeof e.workflowRunUrl==="string"&&RUN.test(e.workflowRunUrl)&&
 typeof e.command==="string"&&e.command.length>0&&e.command.length<=500&&
 typeof e.runtime==="string"&&e.runtime.length>0&&e.runtime.length<=100&&
 Number.isSafeInteger(e.startedAt)&&Number.isSafeInteger(e.completedAt)&&e.completedAt>=e.startedAt&&
 Number.isSafeInteger(e.exitCode)&&["passed","failed","skipped"].includes(e.result)&&
 typeof e.signature==="string"&&e.signature.length>=32&&e.signature.length<=512;
}
export function createMemoryTestEvidenceStore(){
 const records=new Map();
 return Object.freeze({
  async get(key){const value=records.get(key);return value?clone(value):null;},
  async putIfAbsent(key,value){if(records.has(key))return false;records.set(key,clone(value));return true;},
  async list(prefix=""){return [...records.entries()].filter(([key])=>key.startsWith(prefix)).map(([,value])=>clone(value));}
 });
}
export function createTestRegistry({storage,verifyEvidence}={}){
 if(!storage||typeof storage.get!=="function"||typeof storage.putIfAbsent!=="function"||typeof storage.list!=="function")throw new TypeError("ATOMIC_TEST_EVIDENCE_STORAGE_REQUIRED");
 if(typeof verifyEvidence!=="function")throw new TypeError("TRUSTED_CI_EVIDENCE_VERIFIER_REQUIRED");
 async function register(raw){
  if(!validBase(raw))return {ok:false,code:"INVALID_TEST_RECORD"};
  if(raw.status==="executed_pass"||raw.status==="executed_fail")return {ok:false,code:"EXECUTION_EVIDENCE_REQUIRED"};
  if(raw.licenseDecision!=="approved"&&raw.status!=="quarantined")return {ok:false,code:"LICENSE_NOT_APPROVED"};
  const record={...raw,createdAt:Date.now()};
  const inserted=await storage.putIfAbsent("test:"+raw.id,record);
  return inserted?{ok:true,record:clone(record)}:{ok:false,code:"TEST_RECORD_EXISTS"};
 }
 async function recordExecution(id,evidence){
  if(typeof id!=="string"||!ID.test(id)||!validEvidence(evidence))return {ok:false,code:"INVALID_TEST_EVIDENCE"};
  const base=await storage.get("test:"+id);
  if(!base)return {ok:false,code:"TEST_RECORD_NOT_FOUND"};
  if(base.status!=="adapted"&&base.status!=="executed_pass"&&base.status!=="executed_fail")return {ok:false,code:"TEST_NOT_ADAPTED"};
  if(base.licenseDecision!=="approved")return {ok:false,code:"LICENSE_NOT_APPROVED"};
  let verified=false;try{verified=await verifyEvidence(clone(evidence),clone(base))===true;}catch{}
  if(!verified)return {ok:false,code:"UNVERIFIED_CI_EVIDENCE"};
  const status=evidence.exitCode===0&&evidence.result==="passed"?"executed_pass":"executed_fail";
  const runId=evidence.workflowRunUrl.split("/").pop();
  const key="evidence:"+id+":"+evidence.commitSha+":"+runId;
  const entry={testId:id,status,evidence:clone(evidence),recordedAt:Date.now()};
  const inserted=await storage.putIfAbsent(key,entry);
  if(!inserted)return {ok:false,code:"EVIDENCE_ALREADY_RECORDED"};
  return {ok:true,status,evidence:clone(entry)};
 }
 async function get(id){
  const base=await storage.get("test:"+id);if(!base)return null;
  const evidence=(await storage.list("evidence:"+id+":")).sort((a,b)=>a.recordedAt-b.recordedAt);
  const passes=evidence.filter(x=>x.status==="executed_pass");
  const fails=evidence.filter(x=>x.status==="executed_fail");
  return {...clone(base),evidence,passCount:passes.length,failCount:fails.length,
   verifiedPass:passes.length>0&&fails.length===0,
   latestStatus:evidence.length?evidence[evidence.length-1].status:base.status};
 }
 async function list({status,category,limit=100}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new TypeError("INVALID_TEST_REGISTRY_LIMIT");
  const all=await storage.list("test:");
  return all.filter(x=>(status===undefined||x.status===status)&&(category===undefined||x.category===category)).slice(0,limit).map(x=>clone(x));
 }
 return Object.freeze({register,recordExecution,get,list});
}
