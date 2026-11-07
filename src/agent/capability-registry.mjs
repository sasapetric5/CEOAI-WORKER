// CEOAI Capability Registry: deny-by-default authority intersection.
// Agent/skill declarations never grant authority; every principal layer needs an explicit grant.
const ID=/^[a-z][a-z0-9_]{0,47}$/;
const APP=/^[a-z][a-z0-9_-]{0,47}$/;
const PRINCIPAL=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const APPROVAL=/^[A-Za-z0-9_-]{16,128}$/;
const OP=/^[a-z][a-z0-9:_-]{0,63}$/;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const SUBJECTS=new Set(["app","caller","agent","skill"]);
const MAX_GRANTS=5000;
const MAX_TTL=31*24*60*60*1000;
const copy=g=>({subjectType:g.subjectType,subjectId:g.subjectId,appId:g.appId,capabilityId:g.capabilityId,operations:[...g.operations],resourceScopes:[...g.resourceScopes],maxCalls:g.maxCalls,expiresAt:g.expiresAt,approvalRequired:g.approvalRequired});
export function createCapabilityRegistry({grants=[],audit=null,now=()=>Date.now(),verifyApproval=null}={}){
 if(!Array.isArray(grants)||grants.length>MAX_GRANTS)throw new TypeError("INVALID_CAPABILITY_GRANTS");
 if(typeof now!=="function"||(audit!==null&&typeof audit.record!=="function")||(verifyApproval!==null&&typeof verifyApproval!=="function"))throw new TypeError("INVALID_CAPABILITY_DEPENDENCY");
 const usedApprovals=new Set();
 const entries=new Map();
 for(const raw of grants){
  if(!plain(raw)||Object.keys(raw).some(k=>!["subjectType","subjectId","appId","capabilityId","operations","resourceScopes","maxCalls","expiresAt","approvalRequired"].includes(k)))throw new TypeError("INVALID_CAPABILITY_GRANT");
  const {subjectType,subjectId,appId,capabilityId,operations,resourceScopes=[],maxCalls=100,expiresAt=0,approvalRequired=false}=raw;
  if(!SUBJECTS.has(subjectType)||typeof subjectId!=="string"||!(subjectType==="app"?APP:subjectType==="caller"?PRINCIPAL:ID).test(subjectId))throw new TypeError("INVALID_CAPABILITY_SUBJECT");
  if(typeof appId!=="string"||!APP.test(appId)||typeof capabilityId!=="string"||!ID.test(capabilityId))throw new TypeError("INVALID_CAPABILITY_ID");
  if(!Array.isArray(operations)||!operations.length||operations.length>16||operations.some(x=>typeof x!=="string"||!OP.test(x))||new Set(operations).size!==operations.length)throw new TypeError("INVALID_CAPABILITY_OPERATIONS");
  if(!Array.isArray(resourceScopes)||resourceScopes.length>32||resourceScopes.some(x=>typeof x!=="string"||!x.trim()||x.length>256)||new Set(resourceScopes).size!==resourceScopes.length)throw new TypeError("INVALID_CAPABILITY_SCOPES");
  if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>10000||!Number.isSafeInteger(expiresAt)||expiresAt<0||(expiresAt!==0&&expiresAt-now()>MAX_TTL)||typeof approvalRequired!=="boolean")throw new TypeError("INVALID_CAPABILITY_LIMITS");
  const key=[subjectType,subjectId,appId,capabilityId].join(":");
  if(entries.has(key))throw new TypeError("DUPLICATE_CAPABILITY_GRANT");
  entries.set(key,Object.freeze({subjectType,subjectId,appId,capabilityId,operations:Object.freeze([...operations]),resourceScopes:Object.freeze([...resourceScopes]),maxCalls,expiresAt,approvalRequired}));
 }
 const usage=new Map();
 function grantFor(type,id,appId,capabilityId,operation,resource){
  const grant=entries.get([type,id,appId,capabilityId].join(":"));
  if(!grant|| (grant.expiresAt!==0&&grant.expiresAt<=now()) || !grant.operations.includes(operation))return null;
  if(grant.resourceScopes.length&&!grant.resourceScopes.some(scope=>scope.endsWith("*")?resource.startsWith(scope.slice(0,-1)):(resource===scope||resource.startsWith(scope+"/"))))return null;
  return grant;
 }
 function resolve({appId,callerId,agentId,skillId,toolId,operation="execute",resource="",approval=null}={}){
  if(typeof appId!=="string"||!APP.test(appId)||typeof callerId!=="string"||!PRINCIPAL.test(callerId)||
   typeof agentId!=="string"||!ID.test(agentId)||typeof skillId!=="string"||!ID.test(skillId)||
   typeof toolId!=="string"||!ID.test(toolId)||typeof operation!=="string"||!OP.test(operation)||
   typeof resource!=="string"||resource.length>512)return {ok:false,code:"INVALID_CAPABILITY_REQUEST"};
  const layers=[["app",appId],["caller",callerId],["agent",agentId],["skill",skillId]];
  const found=layers.map(([type,id])=>grantFor(type,id,appId,toolId,operation,resource));
  if(found.some(x=>!x)){try{audit?.record({type:"capability_denied",appId,callerId,agentId,skillId,toolId,operation});}catch{}return {ok:false,code:"CAPABILITY_NOT_GRANTED"};}
  const key=[appId,callerId,agentId,skillId,toolId,operation].join(":");
  const used=usage.get(key)||0,limit=Math.min(...found.map(g=>g.maxCalls));
  if(used>=limit)return {ok:false,code:"CAPABILITY_QUOTA_EXCEEDED"};
  const approvalRequired=found.some(g=>g.approvalRequired);
  if(approvalRequired){
   if(!plain(approval)||typeof approval.approvalId!=="string"||!APPROVAL.test(approval.approvalId)||usedApprovals.has(approval.approvalId)||!verifyApproval)return {ok:false,code:"CAPABILITY_APPROVAL_REQUIRED"};
   let verified=false;try{verified=verifyApproval(approval,{appId,callerId,agentId,skillId,toolId,operation,resource})===true;}catch{}
   if(!verified)return {ok:false,code:"CAPABILITY_APPROVAL_REQUIRED"};
  }
  usage.set(key,used+1);
  if(approvalRequired)usedApprovals.add(approval.approvalId);
  const result={ok:true,toolId,operation,approvalRequired,remaining:limit-used-1};
  try{audit?.record({type:"capability_granted",appId,callerId,agentId,skillId,toolId,operation,approvalRequired});}catch{}
  return result;
 }
 function resolveTools({appId,callerId,agentId,skillId,declaredToolIds=[],operation="execute",resource="",approvals={}}={}){
  if(!Array.isArray(declaredToolIds)||declaredToolIds.length>32||declaredToolIds.some(x=>typeof x!=="string"||!ID.test(x))||new Set(declaredToolIds).size!==declaredToolIds.length)return {ok:false,code:"INVALID_DECLARED_TOOLS",allowedToolIds:[]};
  const allowedToolIds=[],denied=[];
  for(const toolId of declaredToolIds){
   const result=resolve({appId,callerId,agentId,skillId,toolId,operation,resource,approval:approvals?.[toolId]??null});
   if(result.ok)allowedToolIds.push(toolId);else denied.push({toolId,code:result.code});
  }
  return {ok:true,allowedToolIds,denied};
 }
 async function authorize({authority,appId,callerId,agentId,skillId,toolId,operation="execute",resource="",approval=null}={}){
  if(!authority||typeof authority.authorize!=="function")return {ok:false,code:"CAPABILITY_AUTHORITY_REQUIRED"};
  if(typeof appId!=="string"||!APP.test(appId)||typeof callerId!=="string"||!PRINCIPAL.test(callerId)||
   typeof agentId!=="string"||!ID.test(agentId)||typeof skillId!=="string"||!ID.test(skillId)||
   typeof toolId!=="string"||!ID.test(toolId)||typeof operation!=="string"||!OP.test(operation)||
   typeof resource!=="string"||resource.length>512)return {ok:false,code:"INVALID_CAPABILITY_REQUEST"};
  const layers=[["app",appId],["caller",callerId],["agent",agentId],["skill",skillId]];
  const found=layers.map(([type,id])=>grantFor(type,id,appId,toolId,operation,resource));
  if(found.some(x=>!x))return {ok:false,code:"CAPABILITY_NOT_GRANTED"};
  const approvalRequired=found.some(g=>g.approvalRequired);
  let approvalId=null;
  if(approvalRequired){
   if(!plain(approval)||typeof approval.approvalId!=="string"||!APPROVAL.test(approval.approvalId)||!verifyApproval)return {ok:false,code:"CAPABILITY_APPROVAL_REQUIRED"};
   let verified=false;try{verified=verifyApproval(approval,{appId,callerId,agentId,skillId,toolId,operation,resource})===true;}catch{}
   if(!verified)return {ok:false,code:"CAPABILITY_APPROVAL_REQUIRED"};
   approvalId=approval.approvalId;
  }
  let result;try{result=await authority.authorize({appId,callerId,agentId,skillId,toolId,operation,resource,maxCalls:Math.min(...found.map(g=>g.maxCalls)),approvalId});}
  catch{return {ok:false,code:"CAPABILITY_AUTHORITY_UNAVAILABLE"};}
  if(result?.ok!==true){try{audit?.record({type:"capability_denied",appId,callerId,agentId,skillId,toolId,operation,code:result?.code??"CAPABILITY_AUTHORITY_UNAVAILABLE"});}catch{}return result?.ok===false?result:{ok:false,code:"CAPABILITY_AUTHORITY_INVALID_RESPONSE"};}
  try{audit?.record({type:"capability_granted",appId,callerId,agentId,skillId,toolId,operation,approvalRequired});}catch{}
  return {...result,approvalRequired};
 }
 return Object.freeze({version:"1.0.0",list(){return [...entries.values()].map(copy);},resolve,authorize,resolveTools,get size(){return entries.size;}});
}
