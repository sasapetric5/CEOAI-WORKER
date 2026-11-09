// Durable, per-app/per-caller capability quota and one-time approval authority.
// All quota increments and approval consumption are serialized in a DO transaction.
const APP=/^[a-z][a-z0-9_-]{0,47}$/;
const PRINCIPAL=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CAPABILITY=/^[a-z][a-z0-9_]{0,47}$/;
const OP=/^[a-z][a-z0-9:_-]{0,63}$/;
const APPROVAL=/^[A-Za-z0-9_-]{16,128}$/;
const KEY=/^[A-Za-z0-9:._-]{1,512}$/;
const json=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const MAX_AUDIT=512;
export class CapabilityAuthorityDO {
 constructor(ctx,{now=()=>Date.now()}={}){if(typeof now!=="function")throw new TypeError("INVALID_CLOCK");this.ctx=ctx;this.now=now;}
 async fetch(request){
  if(request.method!=="POST")return json({ok:false,code:"METHOD_NOT_ALLOWED"},405);
  if(new URL(request.url).pathname!=="/authorize")return json({ok:false,code:"NOT_FOUND"},404);
  let body;try{const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>4096)return json({ok:false,code:"REQUEST_TOO_LARGE"},413);body=JSON.parse(raw);}catch{return json({ok:false,code:"INVALID_JSON"},400);}
  const allowed=["appId","callerId","agentId","skillId","toolId","operation","resource","maxCalls","approvalId","argumentsDigest","effectKey"];
  if(!plain(body)||Object.keys(body).some(k=>!allowed.includes(k))||(Object.keys(body).length<9||Object.keys(body).length>11)||
   typeof body.appId!=="string"||!APP.test(body.appId)||typeof body.callerId!=="string"||!PRINCIPAL.test(body.callerId)||
   typeof body.agentId!=="string"||!CAPABILITY.test(body.agentId)||typeof body.skillId!=="string"||!CAPABILITY.test(body.skillId)||
   typeof body.toolId!=="string"||!CAPABILITY.test(body.toolId)||typeof body.operation!=="string"||!OP.test(body.operation)||
   typeof body.resource!=="string"||body.resource.length>512||!Number.isSafeInteger(body.maxCalls)||body.maxCalls<1||body.maxCalls>10000||
   (body.approvalId!==null&&(typeof body.approvalId!=="string"||!APPROVAL.test(body.approvalId)))||
   (body.argumentsDigest!==undefined&&body.argumentsDigest!==null&&(typeof body.argumentsDigest!=="string"||!/^[a-f0-9]{64}$/.test(body.argumentsDigest)))||
   (body.effectKey!==undefined&&body.effectKey!==null&&(typeof body.effectKey!=="string"||body.effectKey.length>512||!KEY.test(body.effectKey))))return json({ok:false,code:"INVALID_AUTHORITY_REQUEST"},400);
  // Quotas aggregate across resource targets and rotate on the UTC calendar day.
  // A one-time conservative migration carries the legacy lifetime counter into the first
  // daily bucket only; the marker prevents that old value being re-counted on later days.
  const quotaKey=[body.appId,body.callerId,body.agentId,body.skillId,body.toolId,body.operation].join("|");
  const now=this.now();
  if(!Number.isSafeInteger(now)||now<0)return json({ok:false,code:"INVALID_AUTHORITY_CLOCK"},503);
  const utcDay=new Date(now).toISOString().slice(0,10);
  const result=await this.ctx.storage.transaction(async txn=>{
   const usageKey="usage:"+quotaKey+":"+utcDay;
   const migrationKey="usage-migration:v1:"+quotaKey;
   const priorAudit=await txn.get("audit")||[];
   if(!(await txn.get(migrationKey))){
    const currentDaily=await txn.get(usageKey);
    const legacyUsage=await txn.get("usage:"+quotaKey);
    if(currentDaily===undefined&&legacyUsage!==undefined)await txn.put(usageKey,legacyUsage);
    await txn.put(migrationKey,{migratedAt:now,firstDailyBucket:utcDay});
   }
   const record=async(type,code=null)=>{const next=[...priorAudit,{at:this.now(),type,code,appId:body.appId,callerId:body.callerId,agentId:body.agentId,skillId:body.skillId,toolId:body.toolId,operation:body.operation}].slice(-MAX_AUDIT);await txn.put("audit",next);};
   const effectKey=body.effectKey??null;
   const fingerprint=JSON.stringify({appId:body.appId,callerId:body.callerId,agentId:body.agentId,skillId:body.skillId,toolId:body.toolId,operation:body.operation,resource:body.resource,maxCalls:body.maxCalls,approvalId:body.approvalId,argumentsDigest:body.argumentsDigest??null});
   const effectStorageKey=effectKey===null?null:"effect:"+effectKey;
   if(effectStorageKey){
    const priorEffect=await txn.get(effectStorageKey);
    if(priorEffect){
     if(priorEffect.fingerprint!==fingerprint){await record("denied","IDEMPOTENCY_KEY_CONFLICT");return {ok:false,code:"IDEMPOTENCY_KEY_CONFLICT"};}
     return {...priorEffect.result,replayed:true};
    }
   }
   const used=await txn.get(usageKey)||0;
   if(!Number.isSafeInteger(used)||used<0){await record("denied","AUTHORITY_STATE_INVALID");return {ok:false,code:"AUTHORITY_STATE_INVALID"};}
   if(used>=body.maxCalls){await record("denied","CAPABILITY_QUOTA_EXCEEDED");return {ok:false,code:"CAPABILITY_QUOTA_EXCEEDED"};}
   if(body.approvalId!==null){
    const approvalKey="approval:"+body.approvalId;
    if(await txn.get(approvalKey)){await record("denied","CAPABILITY_APPROVAL_REPLAY");return {ok:false,code:"CAPABILITY_APPROVAL_REQUIRED"};}
    await txn.put(approvalKey,{usedAt:now,quotaKey});
   }
   await txn.put(usageKey,used+1);
   await record("granted");
   const granted={ok:true,toolId:body.toolId,operation:body.operation,remaining:body.maxCalls-used-1};
   if(effectStorageKey)await txn.put(effectStorageKey,{fingerprint,result:granted,createdAt:now});
   return granted;
  });
  return json(result,result.ok?200:result.code==="CAPABILITY_QUOTA_EXCEEDED"||result.code==="CAPABILITY_APPROVAL_REQUIRED"?403:503);
 }
}
