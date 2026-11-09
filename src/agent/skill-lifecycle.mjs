// CEOAI Skill Quality & Lifecycle policy.
// This module is deliberately fail-closed: discovery never grants runtime admission.
// Persistent adapters must provide atomic compareAndSet; KV read/write alone is not sufficient.
const ID=/^[a-z][a-z0-9_]{0,47}$/;
const STATUSES=new Set(["DISCOVERED","QUARANTINED","VERIFIED","ACTIVE","DEGRADED","SUSPENDED","REJECTED","REVOKED"]);
const COSTS=new Set(["free","paid","unknown"]);
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const copy=v=>JSON.parse(JSON.stringify(v));
const KEY=id=>"skill-lifecycle:v1:"+id;
const SECURITY_FIELDS=["sourcePinned","licenseVerified","hashVerified","dependenciesReviewed","scriptsReviewed","networkReviewed","credentialsReviewed"];
const MAX_FAILURES=2;
function validId(id){return typeof id==="string"&&ID.test(id);}
function validReview(review){return plain(review)&&Object.keys(review).every(k=>SECURITY_FIELDS.includes(k))&&SECURITY_FIELDS.every(k=>review[k]===true);}
function defaultRecord(id,metadata,now){return {schemaVersion:1,revision:0,id,status:"DISCOVERED",costStatus:"unknown",securityReview:null,quality:{runs:0,passes:0,failures:0,consecutiveFailures:0,lastResult:null},ownerApproved:false,metadata:plain(metadata)?copy(metadata):{},createdAt:now,updatedAt:now,reason:"Awaiting independent review"};}
export function createMemorySkillLifecycleStore(){
 const records=new Map();
 return Object.freeze({
  async get(key){const value=records.get(key);return value?copy(value):null;},
  async putIfAbsent(key,value){if(records.has(key))return false;records.set(key,copy(value));return true;},
  async compareAndSet(key,expectedStatus,expectedRevision,next){const current=records.get(key);if(!current||current.status!==expectedStatus||current.revision!==expectedRevision)return false;records.set(key,copy(next));return true;},
  async list(prefix=""){return [...records.entries()].filter(([key])=>key.startsWith(prefix)).map(([,value])=>copy(value));}
 });
}
export function createSkillLifecycleManager({storage,now=()=>Date.now()}={}){
 if(!storage||typeof storage.get!=="function"||typeof storage.putIfAbsent!=="function"||typeof storage.compareAndSet!=="function"||typeof storage.list!=="function")throw new TypeError("ATOMIC_SKILL_LIFECYCLE_STORAGE_REQUIRED");
 if(typeof now!=="function")throw new TypeError("INVALID_CLOCK");
 async function read(id){return storage.get(KEY(id));}
 async function transition(record,status,reason){
  const next={...record,revision:record.revision+1,status,reason,updatedAt:now()};
  const ok=await storage.compareAndSet(KEY(record.id),record.status,record.revision,next);
  return ok?{ok:true,record:copy(next)}:{ok:false,code:"SKILL_LIFECYCLE_CONFLICT"};
 }
 async function discover({id,metadata={}}={}){
  if(!validId(id)||!plain(metadata)||Object.keys(metadata).length>24)return {ok:false,code:"INVALID_SKILL_CANDIDATE"};
  const record=defaultRecord(id,metadata,now());
  const inserted=await storage.putIfAbsent(KEY(id),record);
  return inserted?{ok:true,record:copy(record)}:{ok:false,code:"SKILL_ALREADY_TRACKED"};
 }
 async function classifyCost(id,costStatus){
  if(!validId(id)||!COSTS.has(costStatus))return {ok:false,code:"INVALID_COST_CLASSIFICATION"};
  const record=await read(id);if(!record)return {ok:false,code:"SKILL_NOT_FOUND"};
  if(["ACTIVE","REVOKED","REJECTED"].includes(record.status))return {ok:false,code:"INVALID_SKILL_STATE"};
  const next={...record,revision:record.revision+1,costStatus,updatedAt:now()};
  if(costStatus==="paid")return transition(record,"REJECTED","Paid skill or paid dependency rejected by free-only policy");
  if(costStatus==="unknown")return transition(record,"QUARANTINED","Cost or required external service is unknown");
  const ok=await storage.compareAndSet(KEY(id),record.status,record.revision,next);
  return ok?{ok:true,record:copy(next)}:{ok:false,code:"SKILL_LIFECYCLE_CONFLICT"};
 }
 async function recordSecurityReview(id,review){
  if(!validId(id)||!validReview(review))return {ok:false,code:"SECURITY_REVIEW_INCOMPLETE"};
  const record=await read(id);if(!record)return {ok:false,code:"SKILL_NOT_FOUND"};
  if(record.status==="REJECTED"||record.status==="REVOKED"||record.status==="ACTIVE")return {ok:false,code:"INVALID_SKILL_STATE"};
  const next={...record,revision:record.revision+1,securityReview:copy(review),updatedAt:now()};
  const ok=await storage.compareAndSet(KEY(id),record.status,record.revision,next);
  return ok?{ok:true,record:copy(next)}:{ok:false,code:"SKILL_LIFECYCLE_CONFLICT"};
 }
 async function recordQualityResult(id,{passed,total,score=0,taskCategory="general",evidenceId=null}={}){
  if(!validId(id)||!Number.isSafeInteger(passed)||!Number.isSafeInteger(total)||total<1||total>100||passed<0||passed>total||typeof score!=="number"||!Number.isFinite(score)||score<0||score>1||typeof taskCategory!=="string"||taskCategory.length>48||(evidenceId!==null&&(typeof evidenceId!=="string"||evidenceId.length>128)))return {ok:false,code:"INVALID_QUALITY_RESULT"};
  const record=await read(id);if(!record)return {ok:false,code:"SKILL_NOT_FOUND"};
  if(["REJECTED","REVOKED","SUSPENDED"].includes(record.status))return {ok:false,code:"SKILL_NOT_ELIGIBLE"};
  const failed=passed!==total||score<0.8;
  const quality={runs:record.quality.runs+1,passes:record.quality.passes+(failed?0:1),failures:record.quality.failures+(failed?1:0),consecutiveFailures:failed?record.quality.consecutiveFailures+1:0,lastResult:{passed,total,score,taskCategory,evidenceId,at:now()}};
  let status=record.status,reason=record.reason;
  if(failed&&quality.consecutiveFailures>=MAX_FAILURES){status="SUSPENDED";reason="Repeated functional quality failures; removed from active selection";}
  else if(failed){status="DEGRADED";reason="Functional quality check failed; retry or review required";}
  else if(record.costStatus==="free"&&validReview(record.securityReview)){status="VERIFIED";reason="Free-cost policy, security review and functional quality checks passed";}
  const next={...record,revision:record.revision+1,quality,status,reason,updatedAt:now()};
  const ok=await storage.compareAndSet(KEY(id),record.status,record.revision,next);
  return ok?{ok:true,record:copy(next)}:{ok:false,code:"SKILL_LIFECYCLE_CONFLICT"};
 }
 async function approveForActivation(id,{approvedByOwner=false}={}){
  if(!validId(id)||approvedByOwner!==true)return {ok:false,code:"EXPLICIT_OWNER_APPROVAL_REQUIRED"};
  const record=await read(id);if(!record)return {ok:false,code:"SKILL_NOT_FOUND"};
  if(record.status!=="VERIFIED"||record.costStatus!=="free"||!validReview(record.securityReview)||record.quality.runs<1||record.quality.consecutiveFailures!==0||record.quality.lastResult?.passed!==record.quality.lastResult?.total||record.quality.lastResult?.score<0.8)return {ok:false,code:"SKILL_NOT_VERIFIED"};
  const next={...record,revision:record.revision+1,ownerApproved:true,updatedAt:now()};
  const ok=await storage.compareAndSet(KEY(id),record.status,record.revision,{...next,status:"ACTIVE",reason:"Owner-approved after verified free-cost, security and quality gates"});
  return ok?{ok:true,record:{...next,status:"ACTIVE",reason:"Owner-approved after verified free-cost, security and quality gates"}}:{ok:false,code:"SKILL_LIFECYCLE_CONFLICT"};
 }
 async function revoke(id,reason="Revoked by trusted policy"){
  if(!validId(id)||typeof reason!=="string"||!reason.trim()||reason.length>240)return {ok:false,code:"INVALID_REVOCATION"};
  const record=await read(id);if(!record)return {ok:false,code:"SKILL_NOT_FOUND"};
  if(record.status==="REVOKED")return {ok:true,record};
  return transition(record,"REVOKED",reason.trim());
 }
 async function get(id){return validId(id)?read(id):null;}
 async function list({status,limit=100}={}){
  if(status!==undefined&&!STATUSES.has(status))throw new TypeError("INVALID_SKILL_LIFECYCLE_STATUS");
  if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new TypeError("INVALID_SKILL_LIFECYCLE_LIMIT");
  const all=await storage.list("skill-lifecycle:v1:");
  return all.filter(x=>status===undefined||x.status===status).slice(0,limit).map(copy);
 }
 function isSelectable(record){return Boolean(record&&record.status==="ACTIVE"&&record.ownerApproved===true&&record.costStatus==="free"&&validReview(record.securityReview)&&record.quality.runs>0&&record.quality.consecutiveFailures===0&&record.quality.lastResult?.passed===record.quality.lastResult?.total&&record.quality.lastResult?.score>=0.8);}
 return Object.freeze({discover,classifyCost,recordSecurityReview,recordQualityResult,approveForActivation,revoke,get,list,isSelectable});
}
