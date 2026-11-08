// CEOAI Capability Registry — HARDENED (Faza 2). Same public API as the original.
// Changes vs original:
//  1. A grant with an empty resourceScopes list no longer authorizes EVERY resource (deny by default).
//     Legacy behaviour is available only with { allowUnscopedGrants: true } while tests are migrated.
//  2. Requested resources must be safe (no "..", encoded dots/slashes, control chars, backslashes).
//  3. authorize() audits denials too (the durable path used to deny silently).
// Notes that are NOT changed but matter:
//  - resolve()/resolveTools() keep per-instance in-memory counters (usage, usedApprovals). The registry is
//    created per request, so these reset every request. Durable quotas and single-use approvals exist ONLY in authorize().
//  - resolve() cannot honour approvals from an async verifier (a Promise is never === true): approval-required
//    tools are always denied there. Use authorize().
import { isSafeResource, isSafeResourceScope } from "./capability-grants.mjs";

const ID=/^[a-z][a-z0-9_]{0,47}$/;
const APP=/^[a-z][a-z0-9_-]{0,47}$/;
const PRINCIPAL=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const APPROVAL=/^[A-Za-z0-9_-]{16,128}$/;
const KEY=/^[A-Za-z0-9:._-]{1,256}$/;
const OP=/^[a-z][a-z0-9:_-]{0,63}$/;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const SUBJECTS=new Set(["app","caller","agent","skill"]);
const GRANT_KEYS=["subjectType","subjectId","appId","capabilityId","operations","resourceScopes","maxCalls","expiresAt","approvalRequired"];
const MAX_GRANTS=5000;
const MAX_TTL=31*24*60*60*1000;
const copy=g=>({subjectType:g.subjectType,subjectId:g.subjectId,appId:g.appId,capabilityId:g.capabilityId,operations:[...g.operations],resourceScopes:[...g.resourceScopes],maxCalls:g.maxCalls,expiresAt:g.expiresAt,approvalRequired:g.approvalRequired});
const resourceOk=r=>typeof r==="string"&&r.length<=512&&(r===""||isSafeResource(r));

export function createCapabilityRegistry({grants=[],audit=null,now=()=>Date.now(),verifyApproval=null,authority=null,allowUnscopedGrants=false}={}){
 if(!Array.isArray(grants)||grants.length>MAX_GRANTS)throw new TypeError("INVALID_CAPABILITY_GRANTS");
 if(typeof now!=="function"||(audit!==null&&typeof audit.record!=="function")||(verifyApproval!==null&&typeof verifyApproval!=="function")||(authority!==null&&typeof authority.authorize!=="function"))throw new TypeError("INVALID_CAPABILITY_DEPENDENCY");
 const usedApprovals=new Set();
 const entries=new Map();
 for(const raw of grants){
  if(!plain(raw)||Object.keys(raw).some(k=>!GRANT_KEYS.includes(k)))throw new TypeError("INVALID_CAPABILITY_GRANT");
  const {subjectType,subjectId,appId,capabilityId,operations,resourceScopes=[],maxCalls=100,expiresAt=0,approvalRequired=false}=raw;
  if(!SUBJECTS.has(subjectType)||typeof subjectId!=="string"||!(subjectType==="app"?APP:subjectType==="caller"?PRINCIPAL:ID).test(subjectId))throw new TypeError("INVALID_CAPABILITY_SUBJECT");
  if(typeof appId!=="string"||!APP.test(appId)||typeof capabilityId!=="string"||!ID.test(capabilityId))throw new TypeError("INVALID_CAPABILITY_ID");
  if(!Array.isArray(operations)||!operations.length||operations.length>16||operations.some(x=>typeof x!=="string"||!OP.test(x))||new Set(operations).size!==operations.length)throw new TypeError("INVALID_CAPABILITY_OPERATIONS");
  if(!Array.isArray(resourceScopes)||resourceScopes.length>32||resourceScopes.some(x=>!isSafeResourceScope(x))||new Set(resourceScopes).size!==resourceScopes.length)throw new TypeError("INVALID_CAPABILITY_SCOPES");
  if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>10000||!Number.isSafeInteger(expiresAt)||expiresAt<0||(expiresAt!==0&&expiresAt-now()>MAX_TTL)||typeof approvalRequired!=="boolean")throw new TypeError("INVALID_CAPABILITY_LIMITS");
  const key=[subjectType,subjectId,appId,capabilityId].join(":");
  if(entries.has(key))throw new TypeError("DUPLICATE_CAPABILITY_GRANT");
  entries.set(key,Object.freeze({subjectType,subjectId,appId,capabilityId,operations:Object.freeze([...operations]),resourceScopes:Object.freeze([...resourceScopes]),maxCalls,expiresAt,approvalRequired}));
 }
 const usage=new Map();
 function grantFor(type,id,appId,capabilityId,operation,resource){
  const grant=entries.get([type,id,appId,capabilityId].join(":"));
  if(!grant||(grant.expiresAt!==0&&grant.expiresAt<=now())||!grant.operations.includes(operation))return null;
  if(!grant.resourceScopes.length){
   if(!allowUnscopedGrants)return null;
  }else if(!grant.resourceScopes.some(scope=>scope.endsWith("/*")?(()=>{const base=scope.slice(0,-2);return resource===base||resource.startsWith(base+"/");})():resource===scope))return null;
  return grant;
 }
 const validRequest=({appId,callerId,agentId,skillId,toolId,operation,resource})=>
  typeof appId==="string"&&APP.test(appId)&&typeof callerId==="string"&&PRINCIPAL.test(callerId)&&
  typeof agentId==="string"&&ID.test(agentId)&&typeof skillId==="string"&&ID.test(skillId)&&
  typeof toolId==="string"&&ID.test(toolId)&&typeof operation==="string"&&OP.test(operation)&&resourceOk(resource);
 function resolve({appId,callerId,agentId,skillId,toolId,operation="execute",resource="",approval=null}={}){
  if(!validRequest({appId,callerId,agentId,skillId,toolId,operation,resource}))return {ok:false,code:"INVALID_CAPABILITY_REQUEST"};
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
 async function authorize({appId,callerId,agentId,skillId,toolId,operation="execute",resource="",argumentsDigest=null,approval=null,effectKey=null}={}){
  if(!authority||typeof authority.authorize!=="function")return {ok:false,code:"CAPABILITY_AUTHORITY_REQUIRED"};
  const deny=(code,extra={})=>{try{audit?.record({type:"capability_denied",appId,callerId,agentId,skillId,toolId,operation,code,...extra});}catch{}return {ok:false,code};};
  if(!validRequest({appId,callerId,agentId,skillId,toolId,operation,resource}))return deny("INVALID_CAPABILITY_REQUEST");
  if(argumentsDigest!==null&&(typeof argumentsDigest!=="string"||!/^[a-f0-9]{64}$/.test(argumentsDigest)))return deny("INVALID_CAPABILITY_ARGUMENTS");
  if(effectKey!==null&&(typeof effectKey!=="string"||effectKey.length>512||!/^[A-Za-z0-9:._-]+$/.test(effectKey)))return deny("INVALID_CAPABILITY_EFFECT_KEY");
  const layers=[["app",appId],["caller",callerId],["agent",agentId],["skill",skillId]];
  const found=layers.map(([type,id])=>grantFor(type,id,appId,toolId,operation,resource));
  if(found.some(x=>!x))return deny("CAPABILITY_NOT_GRANTED");
  const approvalRequired=found.some(g=>g.approvalRequired);
  let approvalId=null;
  if(approvalRequired){
   // The approval ID lives inside the SIGNED payload. A caller-supplied top-level ID is never trusted;
   // every bound claim (incl. argumentsDigest) is verified before the ID reaches the Durable Object.
   const signedApprovalId=plain(approval)&&plain(approval.payload)?approval.payload.approvalId:null;
   if(typeof signedApprovalId!=="string"||!APPROVAL.test(signedApprovalId)||typeof argumentsDigest!=="string"||!/^[a-f0-9]{64}$/.test(argumentsDigest)||typeof effectKey!=="string"||!KEY.test(effectKey)||!verifyApproval)return deny("CAPABILITY_APPROVAL_REQUIRED");
   let verified=false;try{verified=await verifyApproval(approval,{appId,callerId,agentId,skillId,toolId,operation,resource,argumentsDigest,effectKey})===true;}catch{}
   if(!verified)return deny("CAPABILITY_APPROVAL_REQUIRED");
   approvalId=signedApprovalId;
  }
  let result;try{result=await authority.authorize({appId,callerId,agentId,skillId,toolId,operation,resource,maxCalls:Math.min(...found.map(g=>g.maxCalls)),approvalId,argumentsDigest,effectKey});}
  catch{return deny("CAPABILITY_AUTHORITY_UNAVAILABLE");}
  if(result?.ok!==true){
   const code=result?.ok===false&&typeof result.code==="string"?result.code:(result?.ok===false?"CAPABILITY_AUTHORITY_UNAVAILABLE":"CAPABILITY_AUTHORITY_INVALID_RESPONSE");
   try{audit?.record({type:"capability_denied",appId,callerId,agentId,skillId,toolId,operation,code});}catch{}
   return result?.ok===false?result:{ok:false,code:"CAPABILITY_AUTHORITY_INVALID_RESPONSE"};
  }
  try{audit?.record({type:"capability_granted",appId,callerId,agentId,skillId,toolId,operation,approvalRequired});}catch{}
  return {...result,approvalRequired};
 }
 return Object.freeze({version:"1.0.0",durable:authority!==null,list(){return [...entries.values()].map(copy);},resolve,authorize,resolveTools,get size(){return entries.size;}});
}