const ID=/^[a-z][a-z0-9_]{0,47}$/;
const APP=/^[a-z][a-z0-9_-]{0,47}$/;
const PRINCIPAL=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const APPROVAL=/^[A-Za-z0-9_-]{16,128}$/;
const OP=/^[a-z][a-z0-9:_-]{0,63}$/;
const CLAIMS=["appId","callerId","agentId","skillId","toolId","operation","resource","argumentsDigest","effectKey"];
const KEYS=["approvalId",...CLAIMS,"expiresAt"];
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function validToken(t){
 if(!plain(t)||Object.keys(t).length!==3||t.version!==2||typeof t.signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(t.signature)||!plain(t.payload))return false;
 const p=t.payload;
 if(Object.keys(p).length!==KEYS.length||Object.keys(p).some(k=>!KEYS.includes(k)))return false;
 return typeof p.approvalId==="string"&&APPROVAL.test(p.approvalId)&&typeof p.appId==="string"&&APP.test(p.appId)&&
 typeof p.callerId==="string"&&PRINCIPAL.test(p.callerId)&&typeof p.agentId==="string"&&ID.test(p.agentId)&&
 typeof p.skillId==="string"&&ID.test(p.skillId)&&typeof p.toolId==="string"&&ID.test(p.toolId)&&
 typeof p.operation==="string"&&OP.test(p.operation)&&typeof p.resource==="string"&&p.resource.length<=512&&
 typeof p.argumentsDigest==="string"&&/^[a-f0-9]{64}$/.test(p.argumentsDigest)&&typeof p.effectKey==="string"&&/^[A-Za-z0-9:._-]{1,256}$/.test(p.effectKey)&&Number.isSafeInteger(p.expiresAt);
}
export function createCapabilityApprovalProvider(tokens=[]){
 if(!Array.isArray(tokens)||tokens.length>8||tokens.some(t=>!validToken(t)))throw new TypeError("INVALID_APPROVAL_TOKENS");
 const ids=tokens.map(t=>t.payload.approvalId);
 if(new Set(ids).size!==ids.length)throw new TypeError("DUPLICATE_APPROVAL_ID");
 const safe=tokens.map(t=>Object.freeze({version:2,payload:Object.freeze({...t.payload}),signature:t.signature}));
 return async expected=>{
  if(!plain(expected))return null;
  const matches=safe.filter(t=>CLAIMS.every(k=>t.payload[k]===expected[k]));
  return matches.length===1?matches[0]:null;
 };
}
