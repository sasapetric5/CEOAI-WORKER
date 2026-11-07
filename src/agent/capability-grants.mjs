// CEOAI V1 capability grants: server-keyed HMAC signatures, strict claims and expiry.
// The signing key is a dedicated Worker secret; app HMAC keys are never accepted here.
const APP=/^[a-z][a-z0-9_-]{0,47}$/;
const PRINCIPAL=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ID=/^[a-z][a-z0-9_]{0,47}$/;
const OP=/^[a-z][a-z0-9:_-]{0,63}$/;
const SUBJECTS=new Set(["app","caller","agent","skill"]);
const FIELDS=["subjectType","subjectId","appId","capabilityId","operations","resourceScopes","maxCalls","expiresAt","approvalRequired"];
const MAX_TTL=31*24*60*60*1000;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
function canonicalGrant(payload){
 return JSON.stringify({
  subjectType:payload.subjectType,subjectId:payload.subjectId,appId:payload.appId,
  capabilityId:payload.capabilityId,operations:payload.operations,resourceScopes:payload.resourceScopes,
  maxCalls:payload.maxCalls,expiresAt:payload.expiresAt,approvalRequired:payload.approvalRequired
 });
}
function validatePayload(payload,now){
 if(!plain(payload)||Object.keys(payload).length!==FIELDS.length||Object.keys(payload).some(k=>!FIELDS.includes(k)))return false;
 const {subjectType,subjectId,appId,capabilityId,operations,resourceScopes,maxCalls,expiresAt,approvalRequired}=payload;
 if(!SUBJECTS.has(subjectType)||typeof subjectId!=="string"||!(subjectType==="app"?APP:subjectType==="caller"?PRINCIPAL:ID).test(subjectId))return false;
 if(typeof appId!=="string"||!APP.test(appId)||typeof capabilityId!=="string"||!ID.test(capabilityId))return false;
 if(!Array.isArray(operations)||!operations.length||operations.length>16||operations.some(x=>typeof x!=="string"||!OP.test(x))||new Set(operations).size!==operations.length)return false;
 if(!Array.isArray(resourceScopes)||resourceScopes.length>32||resourceScopes.some(x=>typeof x!=="string"||!x.trim()||x.length>256)||new Set(resourceScopes).size!==resourceScopes.length)return false;
 return Number.isSafeInteger(maxCalls)&&maxCalls>=1&&maxCalls<=10000&&Number.isSafeInteger(expiresAt)&&expiresAt>now&&expiresAt-now<=MAX_TTL&&typeof approvalRequired==="boolean";
}
async function keyFor(secret,usage){
 if(typeof secret!=="string"||secret.length<32)throw new TypeError("CAPABILITY_GRANT_SIGNING_KEY_REQUIRED");
 return crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,usage);
}
export async function signCapabilityGrant(payload,secret,{now=Date.now()}={}){
 if(!validatePayload(payload,now))throw new TypeError("INVALID_CAPABILITY_GRANT");
 const key=await keyFor(secret,["sign"]);
 const data=new TextEncoder().encode("CEOAI-CAPABILITY-GRANT-V1\\n"+canonicalGrant(payload));
 const signature=encode(await crypto.subtle.sign("HMAC",key,data));
 return Object.freeze({version:1,payload:JSON.parse(canonicalGrant(payload)),signature});
}
export async function verifyCapabilityGrant(token,secret,{now=Date.now()}={}){
 if(!plain(token)||Object.keys(token).length!==3||token.version!==1||typeof token.signature!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token.signature)||!validatePayload(token.payload,now))return {ok:false,code:"INVALID_CAPABILITY_GRANT"};
 try{
  const key=await keyFor(secret,["verify"]);
  const signature=Uint8Array.from(atob(token.signature.replace(/-/g,"+").replace(/_/g,"/")+"="),c=>c.charCodeAt(0));
  const data=new TextEncoder().encode("CEOAI-CAPABILITY-GRANT-V1\\n"+canonicalGrant(token.payload));
  const valid=await crypto.subtle.verify("HMAC",key,signature,data);
  return valid?{ok:true,grant:JSON.parse(canonicalGrant(token.payload))}:{ok:false,code:"CAPABILITY_GRANT_SIGNATURE_INVALID"};
 }catch{return {ok:false,code:"CAPABILITY_GRANT_VERIFICATION_FAILED"};}
}
export async function loadVerifiedCapabilityGrants(env,{now=Date.now()}={}){
 const raw=env?.CAPABILITY_GRANTS_JSON;
 if(raw===undefined||raw===null||raw==="")return [];
 if(typeof raw!=="string"||raw.length>262144)throw new TypeError("CAPABILITY_GRANT_CONFIG_INVALID");
 let tokens;try{tokens=JSON.parse(raw);}catch{throw new TypeError("CAPABILITY_GRANT_CONFIG_INVALID");}
 if(!Array.isArray(tokens)||tokens.length>5000)throw new TypeError("CAPABILITY_GRANT_CONFIG_INVALID");
 const secret=env.CAPABILITY_GRANT_SIGNING_KEY;
 if(typeof secret!=="string"||secret.length<32)throw new TypeError("CAPABILITY_GRANT_SIGNING_KEY_REQUIRED");
 const grants=[];
 for(const token of tokens){
  const result=await verifyCapabilityGrant(token,secret,{now});
  if(!result.ok)throw new TypeError(result.code);
  grants.push(result.grant);
 }
 return grants;
}

const APPROVAL_FIELDS=["approvalId","appId","callerId","agentId","skillId","toolId","operation","resource","expiresAt"];
function validateApproval(p,now){
 if(!plain(p)||Object.keys(p).length!==APPROVAL_FIELDS.length||Object.keys(p).some(k=>!APPROVAL_FIELDS.includes(k)))return false;
 return typeof p.approvalId==="string"&&/^[A-Za-z0-9_-]{16,128}$/.test(p.approvalId)&&
  typeof p.appId==="string"&&APP.test(p.appId)&&typeof p.callerId==="string"&&PRINCIPAL.test(p.callerId)&&
  typeof p.agentId==="string"&&ID.test(p.agentId)&&typeof p.skillId==="string"&&ID.test(p.skillId)&&
  typeof p.toolId==="string"&&ID.test(p.toolId)&&typeof p.operation==="string"&&OP.test(p.operation)&&
  typeof p.resource==="string"&&p.resource.length<=512&&Number.isSafeInteger(p.expiresAt)&&p.expiresAt>now&&p.expiresAt-now<=10*60*1000;
}
export async function signCapabilityApproval(payload,secret,{now=Date.now()}={}){
 if(!validateApproval(payload,now))throw new TypeError("INVALID_CAPABILITY_APPROVAL");
 const key=await keyFor(secret,["sign"]);
 const data=new TextEncoder().encode("CEOAI-CAPABILITY-APPROVAL-V1\\n"+JSON.stringify(payload));
 return Object.freeze({version:1,payload:JSON.parse(JSON.stringify(payload)),signature:encode(await crypto.subtle.sign("HMAC",key,data))});
}
export async function verifyCapabilityApproval(token,secret,expected,{now=Date.now()}={}){
 if(!plain(token)||Object.keys(token).length!==3||token.version!==1||typeof token.signature!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token.signature)||!validateApproval(token.payload,now))return false;
 const p=token.payload;
 for(const key of APPROVAL_FIELDS.slice(1,-1))if(p[key]!==expected?.[key])return false;
 try{
  const key=await keyFor(secret,["verify"]);
  const signature=Uint8Array.from(atob(token.signature.replace(/-/g,"+").replace(/_/g,"/")+"="),c=>c.charCodeAt(0));
  const data=new TextEncoder().encode("CEOAI-CAPABILITY-APPROVAL-V1\\n"+JSON.stringify(p));
  return await crypto.subtle.verify("HMAC",key,signature,data);
 }catch{return false;}
}
