/** Normalize bounded Crawl4AI extraction output. This parser never crawls or fetches URLs. */
const MAX_BYTES=5_000_000, MAX_TEXT=200_000, MAX_META=100;
function record(v){return v!==null&&typeof v==="object"&&!Array.isArray(v);}
function cleanText(v,limit){return typeof v==="string"?v.replace(/\u0000/g,"").slice(0,limit):null;}
function safeUrl(v){
 if(typeof v!=="string"||v.length>2048)return null;
 try{const u=new URL(v);if(!["https:","http:"].includes(u.protocol)||u.username||u.password)return null;u.search="";u.hash="";return u.toString();}catch{return null;}
}
export function normalizeCrawl4AIResult(input){
 let data=input;
 if(typeof input==="string"){
  if(new TextEncoder().encode(input).byteLength>MAX_BYTES)return {ok:false,code:"CRAWL4AI_RESULT_TOO_LARGE"};
  try{data=JSON.parse(input);}catch{return {ok:false,code:"CRAWL4AI_INVALID_JSON"};}
 }else if(!record(input))return {ok:false,code:"CRAWL4AI_INVALID_SHAPE"};
 if(Array.isArray(data))data=data[0];
 if(!record(data))return {ok:false,code:"CRAWL4AI_INVALID_SHAPE"};
 if(data.success===false||data.status==="failed")return {ok:false,code:"CRAWL4AI_EXTRACTION_FAILED"};
 const content=cleanText(data.markdown ?? data.cleaned_html ?? data.html ?? data.content,MAX_TEXT);
 const url=safeUrl(data.url ?? data.source_url ?? data.final_url);
 if(!content?.trim()||!url)return {ok:false,code:"CRAWL4AI_INVALID_RESULT"};
 const rawMeta=record(data.metadata)?data.metadata:{};
 const metadata={};
 for(const key of ["title","description","language","og:type"]) {
  const value=cleanText(rawMeta[key],500);
  if(value!==null)metadata[key]=value;
 }
 const links=Array.isArray(data.links)?data.links.filter(record).slice(0,MAX_META).map(link=>({url:safeUrl(link.href ?? link.url),text:cleanText(link.text,200)})).filter(link=>link.url):[];
 const images=Array.isArray(data.media?.images)?data.media.images.filter(record).slice(0,MAX_META).map(item=>safeUrl(item.src ?? item.url)).filter(Boolean):[];
 return {ok:true,source:"CRAWL4AI_EXTRACTION",url,content:content.trim(),contentType:typeof data.content_type==="string"?data.content_type.slice(0,80):"text/markdown",metadata,links,images};
}
