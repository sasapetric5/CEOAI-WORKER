// CEOAI capability grants — HARDENED (Faza 2). Backwards compatible with V1 tokens.
// Changes vs original:
//  1. loadVerifiedCapabilityGrants SKIPS validly signed but expired grants. Before, the first expired grant
//     made the loader throw, so the whole agent gateway returned 503 until the config was edited.
//  2. The loader caches verified grants per isolate (original: one HMAC key import + verify per grant,
//     per request, up to 5000 grants).
//  3. resourceScopes must be non-empty and safe (no "..", encoded dots/slashes, control chars). An empty
//     list used to mean "any resource".
//  4. Ed25519 approvals (version 2): the Worker holds only the PUBLIC key, so it cannot mint approvals.
//     HMAC approvals (version 1) are still verifiable, but createApprovalVerifier() disables them unless
//     ALLOW_HMAC_APPROVALS=true, because the Worker holds that key too.
const APP=/^[a-z][a-z0-9_-]{0,47}$/;
const PRINCIPAL=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ID=/^[a-z][a-z0-9_]{0,47}$/;
const OP=/^[a-z][a-z0-9:_-]{0,63}$/;
const SUBJECTS=new Set(["app","caller","agent","skill"]);
const FIELDS=["subjectType","subjectId","appId","capabilityId","operations","resourceScopes","maxCalls","expiresAt","approvalRequired"];
const MAX_TTL=31*24*60*60*1000;
// Literal backslash + n (kept exactly as in the original so existing signatures stay valid).
const GRANT_DOMAIN="CEOAI-CAPABILITY-GRANT-V1\\n";
const APPROVAL_DOMAIN_V1="CEOAI-CAPABILITY-APPROVAL-V1\\n";
const APPROVAL_DOMAIN_V2="CEOAI-CAPABILITY-APPROVAL-V2\n";
const ED={name:"Ed25519"};
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));

// A resource is an opaque string the tool will interpret (path, URL, id). Reject anything that can
// escape a scope by prefix tricks once a tool resolves it.
export function isSafeResource(s){
 return typeof s==="string"&&s.length>0&&s.length<=512&&s===s.trim()&&
  !/[\u0000-\u001f\u007f\\]/.test(s)&&!/(^|\/)\.{1,2}(\/|$)/.test(s)&&!/%(?:25)*(?:2e|2f|5c)/i.test(s);
}
export function isSafeResourceScope(x){
 if(typeof x!=="string"||!x.trim()||x.length>256)return false;
 if(x.endsWith("/*"))return isSafeResource(x.slice(0,-2));
 return !x.includes("*")&&isSafeResource(x);
}

function canonicalGrant(p){
 return JSON.stringify({subjectType:p.subjectType,subjectId:p.subjectId,appId:p.appId,capabilityId:p.capabilityId,
  operations:p.operations,resourceScopes:p.resourceScopes,maxCalls:p.maxCalls,expiresAt:p.expiresAt,approvalRequired:p.approvalRequired});
}
function structureOk(payload){
 if(!plain(payload)||Object.keys(payload).length!==FIELDS.length||Object.keys(payload).some(k=>!FIELDS.includes(k)))return false;
 const {subjectType,subjectId,appId,capabilityId,operations,resourceScopes,maxCalls,expiresAt,approvalRequired}=payload;
 if(!SUBJECTS.has(subjectType)||typeof subjectId!=="string"||!(subjectType==="app"?APP:subjectType==="caller"?PRINCIPAL:ID).test(subjectId))return false;
 if(typeof appId!=="string"||!APP.test(appId)||typeof capabilityId!=="string"||!ID.test(capabilityId))return false;
 if(!Array.isArray(operations)||!operations.length||operations.length>16||operations.some(x=>typeof x!=="string"||!OP.test(x))||new Set(operations).size!==operations.length)return false;
 if(!Array.isArray(resourceScopes)||!resourceScopes.length||resourceScopes.length>32||resourceScopes.some(x=>!isSafeResourceScope(x))||new Set(resourceScopes).size!==resourceScopes.length)return false;
 return Number.isSafeInteger(maxCalls)&&maxCalls>=1&&maxCalls<=10000&&Number.isSafeInteger(expiresAt)&&expiresAt>0&&typeof approvalRequired==="boolean";
}
const timeOk=(p,now)=>p.expiresAt>now&&p.expiresAt-now<=MAX_TTL;
const validatePayload=(p,now)=>structureOk(p)&&timeOk(p,now);

async function keyFor(secret,usage){
 if(typeof secret!=="string"||secret.length<32)throw new TypeError("CAPABILITY_GRANT_SIGNING_KEY_REQUIRED");
 return crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,usage);
}
export async function signCapabilityGrant(payload,secret,{now=Date.now()}={}){
 if(!validatePayload(payload,now))throw new TypeError("INVALID_CAPABILITY_GRANT");
 const key=await keyFor(secret,["sign"]);
 const signature=encode(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(GRANT_DOMAIN+canonicalGrant(payload))));
 return Object.freeze({version:1,payload:JSON.parse(canonicalGrant(payload)),signature});
}
async function checkGrant(token,key,now){
 if(!plain(token)||Object.keys(token).length!==3||token.version!==1||typeof token.signature!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token.signature)||!structureOk(token.payload))return {ok:false,code:"INVALID_CAPABILITY_GRANT"};
 let valid=false;
 try{valid=await crypto.subtle.verify("HMAC",key,decode(token.signature),new TextEncoder().encode(GRANT_DOMAIN+canonicalGrant(token.payload)));}
 catch{return {ok:false,code:"CAPABILITY_GRANT_VERIFICATION_FAILED"};}
 if(!valid)return {ok:false,code:"CAPABILITY_GRANT_SIGNATURE_INVALID"};
 if(!timeOk(token.payload,now))return {ok:false,code:"CAPABILITY_GRANT_EXPIRED"};
 return {ok:true,grant:JSON.parse(canonicalGrant(token.payload))};
}
export async function verifyCapabilityGrant(token,secret,{now=Date.now()}={}){
 let key;try{key=await keyFor(secret,["verify"]);}catch{return {ok:false,code:"CAPABILITY_GRANT_VERIFICATION_FAILED"};}
 const r=await checkGrant(token,key,now);
 return r.code==="CAPABILITY_GRANT_EXPIRED"?{ok:false,code:"INVALID_CAPABILITY_GRANT"}:r; // legacy public code
}

const deepFreezeGrant=g=>Object.freeze({...g,operations:Object.freeze([...g.operations]),resourceScopes:Object.freeze([...g.resourceScopes])});
let cache=null;
export function resetCapabilityGrantCache(){cache=null;}
export async function loadVerifiedCapabilityGrants(env,{now=Date.now()}={}){
 const raw=env?.CAPABILITY_GRANTS_JSON;
 if(raw===undefined||raw===null||raw==="")return [];
 if(typeof raw!=="string"||raw.length>262144)throw new TypeError("CAPABILITY_GRANT_CONFIG_INVALID");
 const secret=env.CAPABILITY_GRANT_SIGNING_KEY;
 if(cache&&cache.raw===raw&&cache.secret===secret&&now<cache.until)return [...cache.grants];
 let tokens;try{tokens=JSON.parse(raw);}catch{throw new TypeError("CAPABILITY_GRANT_CONFIG_INVALID");}
 if(!Array.isArray(tokens)||tokens.length>5000)throw new TypeError("CAPABILITY_GRANT_CONFIG_INVALID");
 if(typeof secret!=="string"||secret.length<32)throw new TypeError("CAPABILITY_GRANT_SIGNING_KEY_REQUIRED");
 const key=await keyFor(secret,["verify"]); // imported once, not once per grant
 const grants=[];let expired=0;
 for(const token of tokens){
  const r=await checkGrant(token,key,now);
  if(r.code==="CAPABILITY_GRANT_EXPIRED"){expired++;continue;} // validly signed, just over: skip, never brick the gateway
  if(!r.ok)throw new TypeError(r.code);                       // forged or malformed: fail loudly
  grants.push(deepFreezeGrant(r.grant));
 }
 if(expired)console.warn("CAPABILITY_GRANTS_EXPIRED_SKIPPED",expired);
 const until=grants.length?Math.min(...grants.map(g=>g.expiresAt)):now+60_000;
 cache={raw,secret,grants:Object.freeze(grants),until};
 return [...cache.grants];
}

// ── arguments digest (unchanged) ──
const APPROVAL_FIELDS=["approvalId","appId","callerId","agentId","skillId","toolId","operation","resource","argumentsDigest","effectKey","expiresAt"];
function canonicalArguments(value,depth=0){
 if(depth>16)throw new TypeError("CAPABILITY_ARGUMENTS_TOO_DEEP");
 if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
 if(typeof value==="number"){if(!Number.isFinite(value))throw new TypeError("INVALID_CAPABILITY_ARGUMENTS");return JSON.stringify(value);}
 if(Array.isArray(value)){
  const keys=Reflect.ownKeys(value);
  if(keys.length!==value.length+1||Array.from({length:value.length},(_,i)=>Object.hasOwn(value,String(i))).some(x=>!x))throw new TypeError("INVALID_CAPABILITY_ARGUMENTS");
  return "["+value.map(item=>canonicalArguments(item,depth+1)).join(",")+"]";
 }
 if(!plain(value))throw new TypeError("INVALID_CAPABILITY_ARGUMENTS");
 const keys=Reflect.ownKeys(value);
 if(keys.some(key=>typeof key!=="string"))throw new TypeError("INVALID_CAPABILITY_ARGUMENTS");
 return "{"+keys.sort().map(key=>{
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!d.enumerable||!Object.hasOwn(d,"value"))throw new TypeError("INVALID_CAPABILITY_ARGUMENTS");
  return JSON.stringify(key)+":"+canonicalArguments(d.value,depth+1);
 }).join(",")+"}";
}
export async function hashCapabilityArguments(value){
 const canonical=canonicalArguments(value);
 if(new TextEncoder().encode(canonical).byteLength>8192)throw new TypeError("CAPABILITY_ARGUMENTS_TOO_LARGE");
 return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical)))].map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ── approvals ──
function validateApproval(p,now){
 if(!plain(p)||Object.keys(p).length!==APPROVAL_FIELDS.length||Object.keys(p).some(k=>!APPROVAL_FIELDS.includes(k)))return false;
 return typeof p.approvalId==="string"&&/^[A-Za-z0-9_-]{16,128}$/.test(p.approvalId)&&
  typeof p.appId==="string"&&APP.test(p.appId)&&typeof p.callerId==="string"&&PRINCIPAL.test(p.callerId)&&
  typeof p.agentId==="string"&&ID.test(p.agentId)&&typeof p.skillId==="string"&&ID.test(p.skillId)&&
  typeof p.toolId==="string"&&ID.test(p.toolId)&&typeof p.operation==="string"&&OP.test(p.operation)&&
  typeof p.resource==="string"&&p.resource.length<=512&&(p.resource===""||isSafeResource(p.resource))&&
  typeof p.argumentsDigest==="string"&&/^[a-f0-9]{64}$/.test(p.argumentsDigest)&&
  typeof p.effectKey==="string"&&/^[A-Za-z0-9:._-]{1,256}$/.test(p.effectKey)&&
  Number.isSafeInteger(p.expiresAt)&&p.expiresAt>now&&p.expiresAt-now<=10*60*1000;
}
const boundFieldsMatch=(p,expected)=>APPROVAL_FIELDS.slice(1,-1).every(k=>p[k]===expected?.[k]);
const canonicalApproval=p=>JSON.stringify(Object.fromEntries(APPROVAL_FIELDS.map(k=>[k,p[k]])));

// V1: HMAC (the Worker holds the key and could mint these — disabled by createApprovalVerifier by default)
export async function signCapabilityApproval(payload,secret,{now=Date.now()}={}){
 if(!validateApproval(payload,now))throw new TypeError("INVALID_CAPABILITY_APPROVAL");
 const key=await keyFor(secret,["sign"]);
 return Object.freeze({version:1,payload:JSON.parse(JSON.stringify(payload)),signature:encode(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(APPROVAL_DOMAIN_V1+JSON.stringify(payload))))});
}
export async function verifyCapabilityApproval(token,secret,expected,{now=Date.now()}={}){
 if(!plain(token)||Object.keys(token).length!==3||token.version!==1||typeof token.signature!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token.signature)||!validateApproval(token.payload,now))return false;
 if(!boundFieldsMatch(token.payload,expected))return false;
 try{
  const key=await keyFor(secret,["verify"]);
  return await crypto.subtle.verify("HMAC",key,decode(token.signature),new TextEncoder().encode(APPROVAL_DOMAIN_V1+JSON.stringify(token.payload)));
 }catch{return false;}
}

// V2: Ed25519 (the owner signs offline with the private key; the Worker only has the public key)
export async function generateApprovalKeyPair(){
 const pair=await crypto.subtle.generateKey(ED,true,["sign","verify"]);
 return {publicKey:encode(await crypto.subtle.exportKey("raw",pair.publicKey)),privateKey:encode(await crypto.subtle.exportKey("pkcs8",pair.privateKey))};
}
export async function signCapabilityApprovalEd25519(payload,privateKeyPkcs8,{now=Date.now()}={}){
 if(!validateApproval(payload,now))throw new TypeError("INVALID_CAPABILITY_APPROVAL");
 const key=await crypto.subtle.importKey("pkcs8",decode(privateKeyPkcs8),ED,false,["sign"]);
 const signature=encode(await crypto.subtle.sign(ED,key,new TextEncoder().encode(APPROVAL_DOMAIN_V2+canonicalApproval(payload))));
 return Object.freeze({version:2,payload:JSON.parse(canonicalApproval(payload)),signature});
}
export async function verifyCapabilityApprovalEd25519(token,publicKeyRaw,expected,{now=Date.now()}={}){
 if(!plain(token)||Object.keys(token).length!==3||token.version!==2||typeof token.signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(token.signature)||!validateApproval(token.payload,now))return false;
 if(!boundFieldsMatch(token.payload,expected))return false;
 try{
  const key=await crypto.subtle.importKey("raw",decode(publicKeyRaw),ED,false,["verify"]);
  return await crypto.subtle.verify(ED,key,decode(token.signature),new TextEncoder().encode(APPROVAL_DOMAIN_V2+canonicalApproval(token.payload)));
 }catch{return false;}
}

// Use this as `verifyApproval` in createCapabilityRegistry.
export function createApprovalVerifier(env,{now}={}){
 const opts=now===undefined?{}:{now};
 return (token,expected)=>{
  if(token?.version===2)return env?.CAPABILITY_APPROVAL_PUBLIC_KEY?verifyCapabilityApprovalEd25519(token,env.CAPABILITY_APPROVAL_PUBLIC_KEY,expected,opts):false;
  if(token?.version===1)return env?.ALLOW_HMAC_APPROVALS==="true"?verifyCapabilityApproval(token,env.CAPABILITY_GRANT_SIGNING_KEY,expected,opts):false;
  return false;
 };
}