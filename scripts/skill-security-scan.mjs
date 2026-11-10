import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateSkillSecurityReport, REQUIRED_SKILL_SCANNERS } from "../src/agent/skill-security-firewall.mjs";

const ROOT=process.cwd();
const SKILL_ROOT=path.resolve(ROOT,process.env.SKILL_SCAN_ROOT||"skills/catalog/external");
const SOURCE_ROOT=path.resolve(ROOT,process.env.SKILL_SCAN_SOURCE_ROOT||SKILL_ROOT);
const REPORT_ROOT=path.resolve(ROOT,process.env.SKILL_SCAN_REPORTS||".reports/skill-security");
const selectedPath=process.env.SKILL_CANDIDATE_PATH||"";
const selectedId=process.env.SKILL_CANDIDATE_ID||"";
const selectedRepository=process.env.SKILL_CANDIDATE_REPOSITORY||"";
const selectedCommit=process.env.SKILL_CANDIDATE_COMMIT||"";
const selectedBlobSha=process.env.SKILL_CANDIDATE_BLOB_SHA||"";
const sha256=value=>createHash("sha256").update(value).digest("hex");
const safeCode=value=>String(value||"SCANNER_FINDING").toUpperCase().replace(/[^A-Z0-9_:-]/g,"_").slice(0,96)||"SCANNER_FINDING";
function run(command,args,timeout=240000){
 const r=spawnSync(command,args,{cwd:ROOT,encoding:"utf8",timeout,maxBuffer:16*1024*1024,windowsHide:true});
 return {status:r.error?null:r.status,stdout:r.stdout||"",stderr:r.stderr||"",error:r.error?.code||null};
}
function version(command,args=["--version"]){const r=run(command,args,30000);return (r.stdout||r.stderr).trim().split(/\r?\n/)[0].slice(0,64)||"unknown";}
function severity(value){
 const v=String(value??"").toLowerCase(),n=Number(value);
 if(["critical","fatal","blocker"].includes(v)||Number.isFinite(n)&&n>=9)return "critical";
 if(["high","error"].includes(v)||Number.isFinite(n)&&n>=7)return "high";
 if(["medium","warning","moderate"].includes(v)||Number.isFinite(n)&&n>=4)return "medium";
 if(v==="low"||Number.isFinite(n)&&n>0)return "low";
 return "info";
}
async function json(file){try{return JSON.parse(await readFile(file,"utf8"));}catch{return null;}}
async function findSkills(root){
 const out=[];
 async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error("SKILL_SYMLINK_REJECTED");if(e.isDirectory())await visit(full);else if(e.isFile()&&e.name.toLowerCase()==="skill.md")out.push(full);}}
 await visit(root);return out.sort();
}
async function walk(dir){
 const out=[];
 async function visit(current){for(const e of await readdir(current,{withFileTypes:true})){const full=path.join(current,e.name),st=await lstat(full);if(st.isSymbolicLink())throw new Error("SKILL_SYMLINK_REJECTED");if(st.isDirectory())await visit(full);else if(st.isFile())out.push(full);if(out.length>64)throw new Error("SKILL_FILE_LIMIT");}}
 await visit(dir);return out.sort();
}
async function scanner(id,versionValue,fn){
 try{const r=await fn();if(r.na)return {scanner:id,version:versionValue,status:"not_applicable",applicabilityReason:r.reason,findings:[]};return {scanner:id,version:versionValue,status:r.findings.length?"findings":"clean",findings:r.findings};}
 catch(e){return {scanner:id,version:versionValue||"unavailable",status:"unavailable",findings:[],error:safeCode(e?.message)};}
}
const codeFiles=files=>files.filter(f=>/\.(c|cc|cpp|cs|go|java|js|jsx|mjs|cjs|py|rb|rs|ts|tsx)$/i.test(f));
const hasDeps=files=>files.some(f=>/(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile\.lock|cargo\.(toml|lock)|go\.(mod|sum)|gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|mix\.lock|pubspec\.lock)$/i.test(path.basename(f)));
const findings=(items,sev,code)=>items.map(x=>({severity:severity(sev(x)),code:safeCode(code(x))}));
function semgrep(report){if(!Array.isArray(report?.results))throw new Error("SEMGREP_REPORT_INVALID");return findings(report.results,x=>x.extra?.severity||x.severity,x=>x.check_id||"SEMGREP_FINDING");}
function gitleaks(report){if(!Array.isArray(report))throw new Error("GITLEAKS_REPORT_INVALID");return findings(report,()=>"high",x=>x.RuleID||x.ruleID||"SECRET_LEAK");}
function codeql(report,skillPath){
 if(!Array.isArray(report?.runs))throw new Error("CODEQL_SARIF_INVALID");
 const out=[];
 for(const r of report.runs){const rules=new Map((r.tool?.driver?.rules||[]).map(x=>[x.id,x]));for(const x of r.results||[]){
  const uris=(x.locations||[]).map(l=>String(l.physicalLocation?.artifactLocation?.uri||"").replace(/\\/g,"/").replace(/^file:\/\//,""));
  if(!uris.some(u=>u===skillPath||u.endsWith("/"+skillPath)||u.includes("/"+skillPath.replace(/\/SKILL\.md$/i,"")+"/")))continue;
  out.push({severity:severity(x.properties?.["security-severity"]??rules.get(x.ruleId)?.properties?.["security-severity"]??x.level),code:safeCode(x.ruleId||"CODEQL_FINDING")});
 }}
 return out;
}
function depscan(report){
 if(!report||typeof report!=="object")throw new Error("DEPSCAN_REPORT_INVALID");
 const out=[],seen=new Set();
 function visit(n,d=0){if(!n||typeof n!=="object"||d>14)return;if(Array.isArray(n)){for(const x of n)visit(x,d+1);return;}
  for(const k of ["vulnerabilities","findings","violations","issues"])if(Array.isArray(n[k]))for(const x of n[k])if(x&&typeof x==="object"){
   const id=x.id||x.cve||x.name||x.package||"DEPENDENCY_FINDING",s=severity(x.severity??x.cvss?.severity??x.cvssScore??x.score??x.risk),key=s+":"+id;
   if(!seen.has(key)){seen.add(key);out.push({severity:s,code:safeCode(id)});}
  }
  for(const [k,v] of Object.entries(n))if(!["vulnerabilities","findings","violations","issues"].includes(k))visit(v,d+1);
 }
 visit(report);return out;
}
async function attest(unsigned,outDir,repo,ref){
 const payload=path.join(outDir,"unsigned.json"),bundle=path.join(outDir,"cosign.bundle.json");
 await writeFile(payload,JSON.stringify(unsigned,null,2)+"\n",{mode:0o600});
 const sign=run("cosign",["sign-blob","--new-bundle-format","--yes","--bundle",bundle,payload],120000);
 if(sign.status!==0)throw new Error("COSIGN_SIGN_FAILED");
 const repoPattern=repo.replace(/\./g,"\\."),refPattern=ref.replace(/\./g,"\\.");
 const identity="^https://github\\.com/"+repoPattern+"/.github/workflows/skill-security-firewall\\.yml@"+refPattern+"$";
 const verify=run("cosign",["verify-blob","--bundle",bundle,"--certificate-identity-regexp",identity,"--certificate-oidc-issuer","https://token.actions.githubusercontent.com",payload],120000);
 if(verify.status!==0)throw new Error("COSIGN_ATTESTATION_VERIFY_FAILED");
 return Buffer.from(await readFile(bundle)).toString("base64");
}
async function scanOne(entry,versions,sarif){
 const folder=path.dirname(entry),files=await walk(folder);let total=0;const items=[];
 for(const file of files){const st=await lstat(file);if(st.size>65536)throw new Error("SKILL_FILE_SIZE_LIMIT");total+=st.size;if(total>262144)throw new Error("SKILL_BUNDLE_SIZE_LIMIT");
  const rel=path.relative(ROOT,file).split(path.sep).join("/"),blob=run("git",["hash-object",file],10000);
  if(blob.status!==0||!/^[a-f0-9]{40}$/.test(blob.stdout.trim()))throw new Error("GIT_BLOB_HASH_FAILED");
  items.push({file,path:rel,size:st.size,blobSha:blob.stdout.trim()});
 }
 const rel=path.relative(ROOT,entry).split(path.sep).join("/"),main=items.find(x=>x.file===entry);
 const content=await readFile(entry,"utf8"),contentSha256=sha256(content);
 const bundleSha256=sha256(items.map(x=>x.path+"\0"+x.blobSha+"\0"+x.size).sort().join("\n"));
 const commit=process.env.GITHUB_SHA||run("git",["rev-parse","HEAD"],10000).stdout.trim();
 const repo=process.env.GITHUB_REPOSITORY||"local/scan";
 const candidate={id:"ci_"+sha256(rel).slice(0,32),repository:repo,path:rel,commit,blobSha:main.blobSha};
 const dir=path.join(REPORT_ROOT,candidate.id);await mkdir(dir,{recursive:true});
 const sources=codeFiles(items.map(x=>x.file)),deps=hasDeps(items.map(x=>x.file));
 const clam=await scanner("clamav",versions.clamav,async()=>{
  const log=path.join(dir,"clamav.log"),r=run("clamscan",["--recursive","--infected","--no-summary","--log="+log,folder],240000);
  if(r.status!==0&&r.status!==1)throw new Error("CLAMAV_EXECUTION_FAILED");
  const txt=await readFile(log,"utf8").catch(()=>r.stdout+"\n"+r.stderr);
  return {findings:txt.split(/\r?\n/).filter(x=>/\bFOUND\s*$/.test(x)).map(()=>({severity:"critical",code:"CLAMAV_MALWARE_DETECTED"}))};
 });
 const sem=await scanner("semgrep",versions.semgrep,async()=>{
  if(!sources.length)return {na:true,reason:"No source code in Skill bundle"};
  const p=path.join(dir,"semgrep.json"),r=run("semgrep",["scan","--config","p/security-audit","--json","--output",p,"--metrics=off",folder],240000);
  if(r.status!==0&&r.status!==1)throw new Error("SEMGREP_EXECUTION_FAILED");
  return {findings:semgrep(await json(p))};
 });
 const leak=await scanner("gitleaks",versions.gitleaks,async()=>{
  const p=path.join(dir,"gitleaks.json"),r=run("gitleaks",["dir",folder,"--report-format","json","--report-path",p,"--redact","--no-banner"],180000);
  if(r.status!==0&&r.status!==1)throw new Error("GITLEAKS_EXECUTION_FAILED");
  return {findings:gitleaks(await json(p))};
 });
 const dep=await scanner("owasp_dep_scan",versions.owasp_dep_scan,async()=>{
  if(!deps)return {na:true,reason:"No dependency manifest or lockfile in Skill bundle"};
  const p=path.join(dir,"depscan.json"),r=run("depscan",["--src",folder,"-o",p,"--profile","appsec"],300000);
  if(r.status!==0&&r.status!==1)throw new Error("DEPSCAN_EXECUTION_FAILED");
  return {findings:depscan(await json(p))};
 });
 const ql=await scanner("codeql",versions.codeql,async()=>{
  if(!sources.length)return {na:true,reason:"No CodeQL-supported source files in Skill bundle"};
  if(!sarif)throw new Error("CODEQL_SARIF_MISSING");
  return {findings:codeql(sarif,rel)};
 });
 const unsigned={schemaVersion:1,policyVersion:"ceoai-skill-firewall-v1",candidate,
  runId:String(process.env.GITHUB_RUN_ID||"local-run"),scannedAt:new Date().toISOString(),
  contentSha256,bundleSha256,scans:[clam,sem,ql,leak,dep]};
 const signerRepository=process.env.GITHUB_REPOSITORY||"sasapetric5/CEOAI-WORKER";
 const envelope=await attest(unsigned,dir,signerRepository,process.env.GITHUB_REF||"refs/heads/local");
 const report={...unsigned,attestation:{envelope}};
 const evaluation=evaluateSkillSecurityReport(report,{expectedContentSha256:contentSha256,expectedBundleSha256:bundleSha256,expectedCandidate:candidate});
 const decision=evaluation.ok?"SCANNED_CLEAN_PENDING_QUALITY":evaluation.severity==="reject"?"REJECTED":"QUARANTINED";
 const output={candidate,contentSha256,bundleSha256,report,evaluation,decision};
 await writeFile(path.join(dir,"report.json"),JSON.stringify(output,null,2)+"\n",{mode:0o600});
 return output;
}
async function main(){
 await mkdir(REPORT_ROOT,{recursive:true});const entries=await findSkills(SKILL_ROOT);
 if(!entries.length)throw new Error("NO_EXTERNAL_SKILLS_FOUND");
 const versions={clamav:version("clamscan"),semgrep:version("semgrep"),codeql:version("codeql",["version"]),gitleaks:version("gitleaks"),owasp_dep_scan:version("depscan",["--version"])};
 const sarif=await json(process.env.CODEQL_SARIF||path.join(REPORT_ROOT,"codeql.sarif"));
 const results=new Array(entries.length);
 const concurrency=Math.max(1,Math.min(8,Number.parseInt(process.env.SKILL_SCAN_CONCURRENCY||"8",10)||8));
 let cursor=0,completed=0;
 async function worker(){
  while(true){
   const index=cursor++;
   if(index>=entries.length)return;
   const entry=entries[index];
   console.log("[skill-security] "+(index+1)+"/"+entries.length+" "+path.relative(ROOT,entry));
   try{results[index]=await scanOne(entry,versions,sarif);}
   catch(e){results[index]={candidatePath:path.relative(ROOT,entry),decision:"QUARANTINED",error:safeCode(e?.message)};}
   completed++;
   console.log("[skill-security] completed "+completed+"/"+entries.length+" decision="+results[index].decision);
  }
 }
 await Promise.all(Array.from({length:Math.min(concurrency,entries.length)},()=>worker()));
 const summary={schemaVersion:1,commit:process.env.GITHUB_SHA||"local",scanned:results.length,
  cleanPendingQuality:results.filter(x=>x.decision==="SCANNED_CLEAN_PENDING_QUALITY").length,
  quarantined:results.filter(x=>x.decision==="QUARANTINED").length,rejected:results.filter(x=>x.decision==="REJECTED").length,results};
 await writeFile(path.join(REPORT_ROOT,"summary.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600});
 console.log(JSON.stringify({scanned:summary.scanned,cleanPendingQuality:summary.cleanPendingQuality,quarantined:summary.quarantined,rejected:summary.rejected}));
 if(summary.quarantined||summary.rejected)process.exitCode=1;
}
main().catch(e=>{console.error("Skill security scan failed closed:",e?.message||e);process.exitCode=2;});
