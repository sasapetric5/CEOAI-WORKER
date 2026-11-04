// CEOAI skill registry: metadata-first discovery and bounded, explicit content loading.
const ID=/^[a-z][a-z0-9_]{0,47}$/;
const TAG=/^[a-z0-9][a-z0-9-]{0,31}$/;
const SOURCE=new Set(["repository","path","license","commit","blobSha"]);
const MAX=24*1024;
const STOP=new Set(["a","an","and","are","as","at","be","by","do","for","from","how","in","is","it","of","on","or","the","this","to","with","za","od","i","u","na","je","da","kako","se","sa","iz"]);
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const norm=v=>v.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const tokens=v=>norm(v).match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu)||[];
function clone(e,content=false){const x={id:e.id,version:e.version,description:e.description,allowedToolIds:[...e.allowedToolIds]};if(e.tags.length)x.tags=[...e.tags];if(e.keywords.length)x.keywords=[...e.keywords];if(e.source)x.source={...e.source};if(e.contentSha256)x.contentSha256=e.contentSha256;if(content&&e.content!==null)x.content=e.content;return x;}
function sourceOf(s,id){if(s==null)return null;if(!plain(s)||Object.keys(s).some(k=>!SOURCE.has(k)))throw new TypeError("INVALID_SKILL_SOURCE:"+id);const x={};for(const [k,v] of Object.entries(s)){if(typeof v!=="string"||!v.trim()||v.length>512)throw new TypeError("INVALID_SKILL_SOURCE:"+id);x[k]=v.trim();}if(!x.repository||!x.path||!x.license||!x.commit||!x.blobSha)throw new TypeError("INCOMPLETE_SKILL_SOURCE:"+id);return Object.freeze(x);}
export function createSkillRegistry({skills=[],toolRegistry,loadContent=null}={}){
 if(!toolRegistry||typeof toolRegistry.get!=="function")throw new TypeError("TOOL_REGISTRY_REQUIRED");
 if(loadContent!==null&&typeof loadContent!=="function")throw new TypeError("INVALID_SKILL_CONTENT_LOADER");
 if(!Array.isArray(skills)||skills.length>10000)throw new TypeError("INVALID_SKILL_COLLECTION");
 const entries=new Map(),indexes=new Map();
 for(const s of skills){
  if(!plain(s)||typeof s.id!=="string"||!ID.test(s.id))throw new TypeError("INVALID_SKILL_ID");
  if(entries.has(s.id))throw new TypeError("DUPLICATE_SKILL:"+s.id);
  if(typeof s.version!=="string"||!/^\d+\.\d+\.\d+$/.test(s.version))throw new TypeError("INVALID_SKILL_VERSION:"+s.id);
  if(typeof s.description!=="string"||!s.description.trim()||s.description.length>240)throw new TypeError("INVALID_SKILL_DESCRIPTION:"+s.id);
  if(!Array.isArray(s.allowedToolIds)||s.allowedToolIds.some(id=>typeof id!=="string"||!toolRegistry.get(id)))throw new TypeError("UNKNOWN_SKILL_TOOL:"+s.id);
  if(new Set(s.allowedToolIds).size!==s.allowedToolIds.length)throw new TypeError("DUPLICATE_SKILL_TOOL:"+s.id);
  const tags=s.tags??[],keywords=s.keywords??[];
  if(!Array.isArray(tags)||tags.length>24||tags.some(t=>typeof t!=="string"||!TAG.test(t)))throw new TypeError("INVALID_SKILL_TAGS:"+s.id);
  if(!Array.isArray(keywords)||keywords.length>32||keywords.some(w=>typeof w!=="string"||!w.trim()||w.length>48))throw new TypeError("INVALID_SKILL_KEYWORDS:"+s.id);
  if(new Set(tags).size!==tags.length||new Set(keywords.map(norm)).size!==keywords.length)throw new TypeError("DUPLICATE_SKILL_TERMS:"+s.id);
  const content=s.content??null;
  if(content!==null&&(typeof content!=="string"||content.includes("\0")||new TextEncoder().encode(content).byteLength>MAX))throw new TypeError("INVALID_SKILL_CONTENT:"+s.id);
  if(s.contentSha256!==undefined&&(typeof s.contentSha256!=="string"||! /^[a-f0-9]{64}$/.test(s.contentSha256)))throw new TypeError("INVALID_SKILL_CONTENT_HASH:"+s.id);
  const e=Object.freeze({id:s.id,version:s.version,description:s.description.trim(),allowedToolIds:Object.freeze([...s.allowedToolIds]),tags:Object.freeze([...tags]),keywords:Object.freeze([...keywords]),source:sourceOf(s.source,s.id),contentSha256:s.contentSha256??null,content});
  entries.set(e.id,e);indexes.set(e.id,new Set(tokens([e.id.replaceAll("_"," "),e.description,...tags,...keywords].join(" ")).filter(t=>!STOP.has(t))));
 }
 return Object.freeze({
  list(){return [...entries.values()].map(e=>clone(e));},
  get(id){const e=entries.get(id);return e?clone(e):null;},
  load(id){const e=entries.get(id);if(!e)return null;if(e.content!==null)return clone(e,true);if(!loadContent)return null;return Promise.resolve().then(()=>loadContent(clone(e))).then(content=>{if(content==null)return null;if(typeof content!=="string"||content.includes("\0")||new TextEncoder().encode(content).byteLength>MAX)throw new TypeError("INVALID_LOADED_SKILL_CONTENT:"+id);return {...clone(e),content};});},
  search(query,{limit=5,requiredTags=[]}={}){if(typeof query!=="string"||!query.trim()||query.length>500)return [];if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw new TypeError("INVALID_SKILL_SEARCH_LIMIT");if(!Array.isArray(requiredTags)||requiredTags.some(t=>typeof t!=="string"||!TAG.test(t)))throw new TypeError("INVALID_SKILL_SEARCH_TAGS");const terms=[...new Set(tokens(query).filter(t=>!STOP.has(t)))];if(!terms.length)return [];const q=norm(query).trim(),required=new Set(requiredTags),out=[];for(const e of entries.values()){if(required.size&&![...required].every(t=>e.tags.includes(t)))continue;const matched=terms.filter(t=>indexes.get(e.id).has(t));if(!matched.length)continue;const tagTerms=new Set(tokens(e.tags.join(" "))),idTerms=new Set(tokens(e.id.replaceAll("_"," ")));let score=0;for(const t of matched)score+=tagTerms.has(t)?4:idTerms.has(t)?3:2;if(q.length>=4&&norm(e.description).includes(q))score+=3;out.push({...clone(e),score,matchedTerms:matched});}return out.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);},
  allows(skillId,toolId){const e=entries.get(skillId);return Boolean(e&&e.allowedToolIds.includes(toolId)&&toolRegistry.get(toolId));},
  get size(){return entries.size;}
 });
}
