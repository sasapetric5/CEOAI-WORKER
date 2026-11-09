import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateSkillSecurityReport, REQUIRED_SKILL_SCANNERS } from "../src/agent/skill-security-firewall.mjs";
const ROOT=process.cwd(),SKILL_ROOT=path.resolve(ROOT,process.env.SKILL_SCAN_ROOT||"skills/catalog/external"),REPORT_ROOT=path.resolve(ROOT,process.env.SKILL_SCAN_REPORTS||".reports/skill-security");
const sha256=v=>createHash("sha256").update(v).digest("hex"),safeCode=v=>String(v||"SCANNER_FINDING").toUpperCase().replace(/[^A-Z0-9_:-]/g,"_").slice(0,96)||"SCANNER_FINDING";
function run(c,a,t=600000){const r=spawnSync(c,a,{cwd:ROOT,encoding:"utf8",timeout:t,maxBuffer:64*1024*1024,windowsHide:true});return {status:r.error?null:r.status,stdout:r.stdout||"",stderr:r.stderr||"",error:r.error?.code||null};}
function version(c,a=["--version"]){const r=run(c,a,30000);return (r.stdout||r.stderr).trim().split(/\r?\n/)[0].slice(0,64)||"unknown";}
function severity(v){const s=String(v??"").toLowerCase(),n=Number(v);if(["critical","fatal","blocker"].includes(s)||Number.isFinite(n)&&n>=9)return "critical";if(["high","error"].includes(s)||Number.isFinite(n)&&n>=7)return "high";if(["medium","warning","moderate"].includes(s)||Number.isFinite(n)&&n>=4)return "medium";if(s==="low"||Number.isFinite(n)&&n>0)return "low";return "info";}
async function json(f){try{return JSON.parse(await readFile(f,"utf8"));}catch{return null;}}
async function findSkills(root){const out=[];async function visit(d){for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isSymbolicLink())throw Error("SKILL_SYMLINK_REJECTED");if(e.isDirectory())await visit(f);else if(e.isFile()&&e.name.toLowerCase()==="skill.md")out.push(f);}}await visit(root);return out.sort();}
async function walk(dir){const out=[];async function visit(d){for(const e of await readdir(d,{withFileTypes:true})){const f=path.join(d,e.name),st=await lstat(f);if(st.isSymbolicLink())throw Error("SKILL_SYMLINK_REJECTED");if(st.isDirectory())await visit(f);else if(st.isFile())out.push(f);if(out.length>256)throw Error("SKILL_FILE_LIMIT");}}await visit(dir);return out.sort();}
const rel=f=>path.relative(ROOT,f).split(path.sep).join("/"),norm=v=>String(v||"").replace(/\\/g,"/").replace(/^\.\/+/,"").replace(/^file:\/\//,"");
const codeFiles=fs=>fs.filter(f=>/\.(c|cc|cpp|cs|go|java|js|jsx|mjs|cjs|py|rb|rs|ts|tsx)$/i.test(f));
const hasDeps=fs=>fs.some(f=>/(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile\.lock|cargo\.(toml|lock)|go\.(mod|sum)|gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|mix\.lock|pubspec\.lock)$/i.test(path.basename(f)));
const inSkill=(file,dir)=>{const f=norm(file),d=norm(dir);return f===d||f.startsWith(d+"/")||f.includes("/"+d+"/")||f.endsWith("/"+d);};
const finding=(s,c)=>({severity:severity(s),code:safeCode(c)});
function parseSemgrep(r){if(!Array.isArray(r?.results))throw Error("SEMGREP_REPORT_INVALID");return r.results.map(x=>({path:norm(x.path),...finding(x.extra?.severity||x.severity,x.check_id||"SEMGREP_FINDING")}));}
function parseGitleaks(r){if(!Array.isArray(r))throw Error("GITLEAKS_REPORT_INVALID");return r.map(x=>({path:norm(x.File||x.file||x.Path||x.path),...finding("high",x.RuleID||x.ruleID||"SECRET_LEAK")}));}
function parseClam(s){const out=[];for(const l of s.split(/\r?\n/)){const m=l.match(/^(.*?):\s+(.+?)\s+FOUND\s*$/);if(m)out.push({path:norm(m[1]),...finding("critical","CLAMAV_"+m[2])});}return out;}
function parseCodeql(r){if(!Array.isArray(r?.runs))throw Error("CODEQL_SARIF_INVALID");const out=[];for(const run of r.runs){const rules=new Map((run.tool?.driver?.rules||[]).map(x=>[x.id,x]));for(const x of run.results||[])for(const loc of x.locations||[]){const p=norm(loc.physicalLocation?.artifactLocation?.uri);if(p)out.push({path:p,...finding(x.properties?.["security-severity"]??rules.get(x.ruleId)?.properties?.["security-severity"]??x.level,x.ruleId||"CODEQL_FINDING")});}}return out;}
function parseDeps(r){if(!r||typeof r!=="object")throw Error("DEPSCAN_REPORT_INVALID");const out=[],seen=new Set();function visit(n,d=0,parentPath=""){if(!n||typeof n!=="object"||d>18)return;if(Array.isArray(n)){for(const x of n)visit(x,d+1,parentPath);return;}const p=n.file||n.path||n.manifest||n.manifest_file||n.source_file||parentPath;for(const k of ["vulnerabilities","findings","violations","issues"])if(Array.isArray(n[k]))for(const x of n[k])if(x&&typeof x==="object"){const f={path:norm(x.file||x.path||x.manifest||x.manifest_file||p),...finding(x.severity??x.cvss?.severity??x.cvssScore??x.score??x.risk,x.id||x.cve||x.name||x.package||"DEPENDENCY_FINDING")};const key=f.path+":"+f.severity+":"+f.code;if(!seen.has(key)){seen.add(key);out.push(f);}}for(const [k,v] of Object.entries(n))if(!["vulnerabilities","findings","violations","issues"].includes(k))visit(v,d+1,p);}visit(r);return out;}
function forSkill(items,dir){return items.filter(x=>x.path&&inSkill(x.path,dir)).map(({severity,code})=>({severity,code}));}
async function runRetry(c,a,t=120000,attempts=3){
 let result;
 for(let attempt=1;attempt<=attempts;attempt++){
  result=run(c,a,t);
  if(result.status===0)return result;
  if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,attempt*1500));
 }
 return result;
}
async function attest(payloadObj,outDir,repo,ref){
 const payload=path.join(outDir,"unsigned.json"),bundle=path.join(outDir,"cosign.bundle.json");
 await writeFile(payload,JSON.stringify(payloadObj,null,2)+"\n",{mode:0o600});
 const s=await runRetry("cosign",["sign-blob","--yes","--bundle",bundle,payload]);
 if(s.status!==0)throw Error("COSIGN_SIGN_FAILED");
 const esc=v=>v.replace(/[|\\{}()[\]^$+*?.-]/g,"\\$&");
 const identity="^https://github\\.com/"+esc(repo)+"/.github/workflows/skill-security-firewall\\.yml@"+esc(ref)+"$";
 const v=await runRetry("cosign",["verify-blob","--bundle",bundle,"--certificate-identity-regexp",identity,"--certificate-oidc-issuer","https://token.actions.githubusercontent.com",payload]);
 if(v.status!==0)throw Error("COSIGN_ATTESTATION_VERIFY_FAILED");
 return Buffer.from(await readFile(bundle)).toString("base64");
}
async function main(){
 await mkdir(REPORT_ROOT,{recursive:true});const entries=await findSkills(SKILL_ROOT);if(!entries.length)throw Error("NO_EXTERNAL_SKILLS_FOUND");
 const candidates=[];
 for(const entry of entries){const folder=path.dirname(entry),files=await walk(folder);let total=0;const items=[];for(const file of files){const st=await lstat(file);if(st.size>65536)throw Error("SKILL_FILE_SIZE_LIMIT");total+=st.size;if(total>262144)throw Error("SKILL_BUNDLE_SIZE_LIMIT");const b=run("git",["hash-object",file],10000);if(b.status!==0||!/^[a-f0-9]{40}$/.test(b.stdout.trim()))throw Error("GIT_BLOB_HASH_FAILED");items.push({file,path:rel(file),size:st.size,blobSha:b.stdout.trim()});}
  const entryRel=rel(entry),main=items.find(x=>x.file===entry),content=await readFile(entry,"utf8"),contentSha256=sha256(content),bundleSha256=sha256(items.map(x=>x.path+"\0"+x.blobSha+"\0"+x.size).sort().join("\n")),commit=process.env.GITHUB_SHA||run("git",["rev-parse","HEAD"],10000).stdout.trim(),repo=process.env.GITHUB_REPOSITORY||"local/scan";
  candidates.push({entry,folder,files:items,content,contentSha256,bundleSha256,dir:rel(folder),candidate:{id:"ci_"+sha256(entryRel).slice(0,32),repository:repo,path:entryRel,commit,blobSha:main.blobSha}});
 }
 const allFiles=candidates.flatMap(c=>c.files.map(x=>x.file)),hasSource=allFiles.some(f=>codeFiles([f]).length),hasDependency=allFiles.some(f=>hasDeps([f]));
 const versions={clamav:version("clamscan"),semgrep:version("semgrep"),codeql:version("codeql",["version"]),gitleaks:version("gitleaks"),owasp_dep_scan:version("depscan",["--version"])};
 console.log("[skill-security] "+candidates.length+" Skills found; each collection scanner will run once");
 const global={};
 async function collect(id,fn){try{global[id]=await fn();console.log("[skill-security] "+id+" done; findings="+global[id].findings.length);}catch(e){global[id]={status:"unavailable",findings:[],error:safeCode(e?.message)};console.error("[skill-security] "+id+" unavailable: "+global[id].error);}}
 await Promise.all([
  collect("clamav",async()=>{const p=path.join(REPORT_ROOT,"clamav.log"),r=run("clamscan",["--recursive","--infected","--no-summary","--log="+p,SKILL_ROOT]);if(r.status!==0&&r.status!==1)throw Error("CLAMAV_EXECUTION_FAILED");return {status:"ok",findings:parseClam(await readFile(p,"utf8").catch(()=>r.stdout+"\n"+r.stderr))};}),
  collect("semgrep",async()=>{if(!hasSource)return {status:"not_applicable",reason:"No source code in external Skill collection",findings:[]};const p=path.join(REPORT_ROOT,"semgrep.json"),r=run("semgrep",["scan","--config","p/security-audit","--json","--output",p,"--metrics=off",SKILL_ROOT]);if(r.status!==0&&r.status!==1)throw Error("SEMGREP_EXECUTION_FAILED");return {status:"ok",findings:parseSemgrep(await json(p))};}),
  collect("gitleaks",async()=>{const p=path.join(REPORT_ROOT,"gitleaks.json"),r=run("gitleaks",["dir",SKILL_ROOT,"--report-format","json","--report-path",p,"--redact","--no-banner"]);if(r.status!==0&&r.status!==1)throw Error("GITLEAKS_EXECUTION_FAILED");return {status:"ok",findings:parseGitleaks(await json(p))};}),
  collect("owasp_dep_scan",async()=>{if(!hasDependency)return {status:"not_applicable",reason:"No dependency manifests in external Skill collection",findings:[]};const p=path.join(REPORT_ROOT,"depscan.json"),r=run("depscan",["--src",SKILL_ROOT,"-o",p,"--profile","appsec"]);if(r.status!==0&&r.status!==1)throw Error("DEPSCAN_EXECUTION_FAILED");return {status:"ok",findings:parseDeps(await json(p))};})
 ]);
 if(hasSource){try{global.codeql={status:"ok",findings:parseCodeql(await json(process.env.CODEQL_SARIF||path.join(REPORT_ROOT,"codeql.sarif")))};}catch{global.codeql={status:"unavailable",findings:[],error:"CODEQL_SARIF_INVALID"};}}
 else global.codeql={status:"not_applicable",reason:"No CodeQL-supported source files in external Skill collection",findings:[]};
 const results=[];
 for(let i=0;i<candidates.length;i++){const c=candidates[i],dir=path.join(REPORT_ROOT,c.candidate.id);await mkdir(dir,{recursive:true});
  const scans=REQUIRED_SKILL_SCANNERS.map(id=>{const g=global[id]||{status:"unavailable",findings:[]};if(g.status==="unavailable")return {scanner:id,version:versions[id]||"unavailable",status:"unavailable",findings:[]};if(g.status==="not_applicable")return {scanner:id,version:versions[id]||"unknown",status:"not_applicable",applicabilityReason:g.reason,findings:[]};const fs=forSkill(g.findings,c.dir);return {scanner:id,version:versions[id]||"unknown",status:fs.length?"findings":"clean",findings:fs};});
  const unsigned={schemaVersion:1,policyVersion:"ceoai-skill-firewall-v1",candidate:c.candidate,runId:String(process.env.GITHUB_RUN_ID||"local-run"),scannedAt:new Date().toISOString(),contentSha256:c.contentSha256,bundleSha256:c.bundleSha256,scans};let output;
  try{const envelope=await attest(unsigned,dir,c.candidate.repository,process.env.GITHUB_REF||"refs/heads/local"),report={...unsigned,attestation:{envelope}},evaluation=evaluateSkillSecurityReport(report,{expectedContentSha256:c.contentSha256,expectedBundleSha256:c.bundleSha256,expectedCandidate:c.candidate}),decision=evaluation.ok?"SCANNED_CLEAN_PENDING_QUALITY":evaluation.severity==="reject"?"REJECTED":"QUARANTINED";output={candidate:c.candidate,contentSha256:c.contentSha256,bundleSha256:c.bundleSha256,report,evaluation,decision};}
  catch(e){output={candidate:c.candidate,decision:"QUARANTINED",error:safeCode(e?.message)};}
  await writeFile(path.join(dir,"report.json"),JSON.stringify(output,null,2)+"\n",{mode:0o600});results.push(output);if((i+1)%10===0||i===candidates.length-1)console.log("[skill-security] signed "+(i+1)+"/"+candidates.length+" decision="+output.decision);
 }
 const summary={schemaVersion:1,commit:process.env.GITHUB_SHA||"local",scanned:results.length,cleanPendingQuality:results.filter(x=>x.decision==="SCANNED_CLEAN_PENDING_QUALITY").length,quarantined:results.filter(x=>x.decision==="QUARANTINED").length,rejected:results.filter(x=>x.decision==="REJECTED").length,results};
 await writeFile(path.join(REPORT_ROOT,"summary.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({scanned:summary.scanned,cleanPendingQuality:summary.cleanPendingQuality,quarantined:summary.quarantined,rejected:summary.rejected}));if(summary.quarantined||summary.rejected)process.exitCode=1;
}
main().catch(e=>{console.error("Skill security batch scan failed closed:",e?.message||e);process.exitCode=2;});
