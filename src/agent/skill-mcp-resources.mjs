// Authenticated, read-only MCP resource adapter for the CEOAI skill catalog.
const ID=/^[a-z][a-z0-9_]{0,47}$/;
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
export function createSkillMCPResources({skillRegistry,authorize,maxPageSize=20,audit=null}={}){
 if(!skillRegistry||typeof skillRegistry.list!=="function"||typeof skillRegistry.load!=="function")throw new TypeError("SKILL_REGISTRY_REQUIRED");
 if(typeof authorize!=="function")throw new TypeError("MCP_AUTHORIZER_REQUIRED");
 if(!Number.isSafeInteger(maxPageSize)||maxPageSize<1||maxPageSize>100)throw new TypeError("INVALID_MCP_PAGE_SIZE");
 if(audit!==null&&typeof audit!=="function")throw new TypeError("INVALID_MCP_AUDIT");
 const record=e=>{try{audit?.(e);}catch{}};
 async function handle({method,params={},authContext}={}){
  if(typeof method!=="string"||!["resources/list","resources/read"].includes(method))return {ok:false,error:{code:"METHOD_NOT_FOUND"}};
  let allowed=false;
  try{allowed=await authorize(authContext,{method});}catch{}
  if(allowed!==true){record({type:"mcp_denied",method});return {ok:false,error:{code:"ACCESS_DENIED"}};}
  if(!plain(params))return {ok:false,error:{code:"INVALID_PARAMS"}};
  if(method==="resources/list"){
   const cursor=params.cursor??"0";
   if(typeof cursor!=="string"||!/^(0|[1-9][0-9]{0,5})$/.test(cursor))return {ok:false,error:{code:"INVALID_CURSOR"}};
   const offset=Number(cursor),all=skillRegistry.list().sort((a,b)=>a.id.localeCompare(b.id));
   if(offset>all.length)return {ok:false,error:{code:"INVALID_CURSOR"}};
   const page=all.slice(offset,offset+maxPageSize);
   record({type:"mcp_resources_listed",count:page.length});
   return {ok:true,resources:page.map(s=>({uri:"ceoai://skills/"+s.id,name:s.id,description:s.description,mimeType:"text/markdown"})),...(offset+page.length<all.length?{nextCursor:String(offset+page.length)}:{})};
  }
  const uri=params.uri;
  if(typeof uri!=="string"||uri.length>128)return {ok:false,error:{code:"INVALID_RESOURCE_URI"}};
  const match=/^ceoai:\/\/skills\/([a-z][a-z0-9_]{0,47})$/.exec(uri);
  if(!match||!ID.test(match[1]))return {ok:false,error:{code:"INVALID_RESOURCE_URI"}};
  let skill;
  try{skill=await skillRegistry.load(match[1]);}catch{record({type:"mcp_resource_read_failed",skillId:match[1]});return {ok:false,error:{code:"RESOURCE_UNAVAILABLE"}};}
  if(!skill||typeof skill.content!=="string")return {ok:false,error:{code:"RESOURCE_NOT_FOUND"}};
  record({type:"mcp_resource_read",skillId:match[1]});
  return {ok:true,contents:[{uri,mimeType:"text/markdown",text:skill.content}]};
 }
 return Object.freeze({handle});
}
