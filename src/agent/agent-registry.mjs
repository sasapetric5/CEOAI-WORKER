// Curated specialist-agent catalog. Agents define bounded roles; they do not own tool permissions.
const ID=/^[a-z][a-z0-9_]{0,47}$/;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const norm=s=>s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const words=s=>norm(s).match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu)||[];
const STOP=new Set(["a","an","and","are","as","at","be","by","do","for","from","how","in","is","it","of","on","or","the","this","to","with","za","od","i","u","na","je","da","kako","se","sa","iz"]);
function copy(a){return {id:a.id,version:a.version,role:a.role,description:a.description,skillIds:[...a.skillIds],keywords:[...a.keywords],allowedToolIds:[...a.allowedToolIds]};}
export function createAgentRegistry({agents=[],skillRegistry,toolRegistry}={}){
 if(!skillRegistry||typeof skillRegistry.get!=="function"||typeof skillRegistry.search!=="function")throw new TypeError("SKILL_REGISTRY_REQUIRED");
 if(!toolRegistry||typeof toolRegistry.get!=="function")throw new TypeError("TOOL_REGISTRY_REQUIRED");
 if(!Array.isArray(agents)||agents.length>100)throw new TypeError("INVALID_AGENT_COLLECTION");
 const entries=new Map();
 for(const a of agents){
  if(!plain(a)||typeof a.id!=="string"||!ID.test(a.id)||entries.has(a.id))throw new TypeError("INVALID_OR_DUPLICATE_AGENT_ID");
  if(typeof a.version!=="string"||!/^\d+\.\d+\.\d+$/.test(a.version))throw new TypeError("INVALID_AGENT_VERSION:"+a.id);
  if(typeof a.role!=="string"||!a.role.trim()||a.role.length>80||typeof a.description!=="string"||!a.description.trim()||a.description.length>240)throw new TypeError("INVALID_AGENT_PROFILE:"+a.id);
  if(!Array.isArray(a.skillIds)||!a.skillIds.length||a.skillIds.length>12||a.skillIds.some(id=>typeof id!=="string"||!skillRegistry.get(id))||new Set(a.skillIds).size!==a.skillIds.length)throw new TypeError("INVALID_AGENT_SKILLS:"+a.id);
  if(!Array.isArray(a.keywords)||!a.keywords.length||a.keywords.length>32||a.keywords.some(w=>typeof w!=="string"||!w.trim()||w.length>48))throw new TypeError("INVALID_AGENT_KEYWORDS:"+a.id);
  if(!Array.isArray(a.allowedToolIds)||a.allowedToolIds.length>12||a.allowedToolIds.some(id=>typeof id!=="string"||!toolRegistry.get(id))||new Set(a.allowedToolIds).size!==a.allowedToolIds.length)throw new TypeError("INVALID_AGENT_CAPABILITIES:"+a.id);
  entries.set(a.id,Object.freeze({id:a.id,version:a.version,role:a.role.trim(),description:a.description.trim(),skillIds:Object.freeze([...a.skillIds]),keywords:Object.freeze([...a.keywords]),allowedToolIds:Object.freeze([...a.allowedToolIds])}));
 }
 return Object.freeze({
  list(){return [...entries.values()].map(copy);},
  get(id){const a=entries.get(id);return a?copy(a):null;},
  search(task,{limit=3}={}){
   if(typeof task!=="string"||!task.trim()||task.length>4000)return [];
   if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw new TypeError("INVALID_AGENT_SEARCH_LIMIT");
   const terms=[...new Set(words(task).filter(w=>!STOP.has(w)))];if(!terms.length)return [];
   const skillMatches=skillRegistry.search(task.trim().slice(0,500),{limit:20});
   const ranked=[];
   for(const a of entries.values()){
    const matched=terms.filter(term=>a.keywords.some(k=>words(k).includes(term))||words(a.role+" "+a.description).includes(term));
    const skillMatch=skillMatches.filter(s=>a.skillIds.includes(s.id)).sort((x,y)=>y.score-x.score||x.id.localeCompare(y.id))[0];
    if(!skillMatch)continue;
    const score=matched.length*3+(skillMatch.score??0);
    ranked.push({...copy(a),score,matchedTerms:matched,skillId:skillMatch.id});
   }
   return ranked.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
  },
  get size(){return entries.size;}
 });
}
