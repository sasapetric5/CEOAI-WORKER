// Durable Object adapter for the atomic, persistent Skill Lifecycle registry.
// All records share one named object so list and compare-and-set have consistent semantics.
const SKILL_ID=/^[a-z][a-z0-9_]{0,47}$/;
const KEY=id=>"skillLifecycle:"+id;
export function createCloudflareSkillLifecycleStore(namespace){
 if(!namespace||typeof namespace.idFromName!=="function"||typeof namespace.get!=="function")throw new TypeError("SKILL_LIFECYCLE_BINDING_REQUIRED");
 const stub=namespace.get(namespace.idFromName("skill-lifecycle-global"));
 async function request(path,payload={}){
  const response=await stub.fetch("https://skill-lifecycle.internal"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:"skill-lifecycle-global",...payload})});
  let result;try{result=await response.json();}catch{throw new Error("SKILL_LIFECYCLE_INVALID_RESPONSE");}
  if(!response.ok||result?.ok!==true){const error=new Error(result?.code||"SKILL_LIFECYCLE_UNAVAILABLE");error.code=result?.code||"SKILL_LIFECYCLE_UNAVAILABLE";throw error;}
  return result;
 }
 return Object.freeze({
  async get(key){if(typeof key!=="string"||!key.startsWith("skill-lifecycle:v1:"))throw new TypeError("INVALID_SKILL_LIFECYCLE_KEY");const id=key.slice("skill-lifecycle:v1:".length);if(!SKILL_ID.test(id))throw new TypeError("INVALID_SKILL_ID");return (await request("/skill/get",{skillId:id})).record;},
  async putIfAbsent(key,value){if(typeof key!=="string"||!key.startsWith("skill-lifecycle:v1:")||!value||!SKILL_ID.test(key.slice("skill-lifecycle:v1:".length)))throw new TypeError("INVALID_SKILL_LIFECYCLE_KEY");try{await request("/skill/create",{skillId:value.id,skillRecord:value});return true;}catch(error){if(error.code==="SKILL_ALREADY_TRACKED")return false;throw error;}},
  async compareAndSet(key,expectedStatus,expectedRevision,next){if(typeof key!=="string"||!key.startsWith("skill-lifecycle:v1:"))throw new TypeError("INVALID_SKILL_LIFECYCLE_KEY");const id=key.slice("skill-lifecycle:v1:".length);if(!SKILL_ID.test(id)||!Number.isSafeInteger(expectedRevision)||!next||next.id!==id)throw new TypeError("INVALID_SKILL_LIFECYCLE_CAS");try{await request("/skill/cas",{skillId:id,expectedStatus,expectedSkillRevision:expectedRevision,skillRecord:next});return true;}catch(error){if(["SKILL_LIFECYCLE_CONFLICT","SKILL_NOT_FOUND"].includes(error.code))return false;throw error;}},
  async list(prefix="skill-lifecycle:v1:"){if(prefix!=="skill-lifecycle:v1:")throw new TypeError("INVALID_SKILL_LIFECYCLE_PREFIX");return (await request("/skill/list")).records;}
 });
}
