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
 constructor(ctx){this.ctx=ctx;}
 async fetch(request){
  if(request.method!=="POST")return json({ok:false,code:"METHOD_NOT_ALLOWED"},405);
  if(new URL(request.url).pathname!=="/authorize")return json({ok:false,code:"NOT_FOUND"},404);
  let body;try{const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>4096)return json({ok:false,code:"REQUEST_TOO_LARGE"},413);body=JSON.parse(raw);}catch{return json({ok:false,code:"INVALID_JSON"},400);}
  const allowed=["appId","callerId","agentId","skillId","toolId","operation","resource","maxCalls","approvalId"];
  if(!plain(body)||Object.keys(body).some(k=>!allowed.includes(k))||Object.keys(body).length!==9||
   typeof body.appId!=="string"||!APP.test(body.appId)||typeof body.callerId!=="string"||!PRINCIPAL.test(body.callerId)||
   typeof body.agentId!=="string"||!CAPABILITY.test(body.agentId)||typeof body.skillId!=="string"||!CAPABILITY.test(body.skillId)||
   typeof body.toolId!=="string"||!CAPABILITY.test(body.toolId)||typeof body.operation!=="string"||!OP.test(body.operation)||
   typeof body.resource!=="string"||body.resource.length>512||!Number.isSafeInteger(body.maxCalls)||body.maxCalls<1||body.maxCalls>10000||
   (body.approvalId!==null&&(typeof body.approvalId!=="string"||!APPROVAL.test(body.approvalId))))return json({ok:false,code:"INVALID_AUTHORITY_REQUEST"},400);
  const quotaKey=[body.appId,body.callerId,body.agentId,body.skillId,body.toolId,body.operation,body.resource].join("|");
  const result=await this.ctx.storage.transaction(async txn=>{
   const usageKey="usage:"+quotaKey;
   const used=await txn.get(usageKey)||0;
   const priorAudit=await txn.get("audit")||[];
   const record=async(type,code=null)=>{const next=[...priorAudit,{at:Date.now(),type,code,appId:body.appId,callerId:body.callerId,agentId:body.agentId,skillId:body.skillId,toolId:body.toolId,operation:body.operation}].slice(-MAX_AUDIT);await txn.put("audit",next);};
   if(!Number.isSafeInteger(used)||used<0){await record("denied","AUTHORITY_STATE_INVALID");return {ok:false,code:"AUTHORITY_STATE_INVALID"};}
   if(used>=body.maxCalls){await record("denied","CAPABILITY_QUOTA_EXCEEDED");return {ok:false,code:"CAPABILITY_QUOTA_EXCEEDED"};}
   if(body.approvalId!==null){
    const approvalKey="approval:"+body.approvalId;
    if(await txn.get(approvalKey)){await record("denied","CAPABILITY_APPROVAL_REPLAY");return {ok:false,code:"CAPABILITY_APPROVAL_REQUIRED"};}
    await txn.put(approvalKey,{usedAt:Date.now(),quotaKey});
   }
   await txn.put(usageKey,used+1);
   await record("granted");
   return {ok:true,toolId:body.toolId,operation:body.operation,remaining:body.maxCalls-used-1};
  });
  return json(result,result.ok?200:result.code==="CAPABILITY_QUOTA_EXCEEDED"||result.code==="CAPABILITY_APPROVAL_REQUIRED"?403:503);
 }
}
