// Fail-closed client for the durable capability authority Durable Object.
const APP=/^[a-z][a-z0-9_-]{0,47}$/;
const PRINCIPAL=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
export function createCloudflareCapabilityAuthority(namespace){
 if(!namespace||typeof namespace.idFromName!=="function"||typeof namespace.get!=="function")throw new TypeError("CAPABILITY_AUTHORITY_BINDING_REQUIRED");
 return Object.freeze({async authorize(input={}){
  if(!plain(input)||typeof input.appId!=="string"||!APP.test(input.appId)||typeof input.callerId!=="string"||!PRINCIPAL.test(input.callerId))return {ok:false,code:"INVALID_AUTHORITY_REQUEST"};
  const name=input.appId+":"+input.callerId;
  const stub=namespace.get(namespace.idFromName(name));
  let response;
  try{response=await stub.fetch("https://capability-authority.internal/authorize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input})});}
  catch{return {ok:false,code:"CAPABILITY_AUTHORITY_UNAVAILABLE"};}
  let result;try{result=await response.json();}catch{return {ok:false,code:"CAPABILITY_AUTHORITY_INVALID_RESPONSE"};}
  if(!response.ok||result?.ok!==true)return {ok:false,code:typeof result?.code==="string"?result.code:"CAPABILITY_AUTHORITY_UNAVAILABLE"};
  return result;
 }});
}
