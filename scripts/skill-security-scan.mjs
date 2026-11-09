import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSkillSecurityReport, REQUIRED_SKILL_SCANNERS } from "../src/agent/skill-security-firewall.mjs";

const ROOT = process.cwd();
const SKILL_ROOT = path.resolve(ROOT, process.env.SKILL_SCAN_ROOT || "skills/catalog/external");
const REPORT_ROOT = path.resolve(ROOT, process.env.SKILL_SCAN_REPORTS || ".reports/skill-security");
const MAX_FILES = 64;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const safeCode = value => String(value || "SCANNER_FINDING").toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 96) || "SCANNER_FINDING";
const severity = value => {
  const v = String(value || "").toLowerCase();
  if (["critical", "fatal", "blocker"].includes(v) || Number(value) >= 9) return "critical";
  if (["high", "error"].includes(v) || Number(value) >= 7) return "high";
  if (["medium", "warning", "moderate"].includes(v) || Number(value) >= 4) return "medium";
  if (["low"].includes(v) || Number(value) > 0) return "low";
  return "info";
};
function run(command, args, { timeout = 180000, maxBuffer = 12 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", timeout, maxBuffer, windowsHide: true });
  if (result.error) return { ok: false, code: result.error.code || "SCANNER_EXECUTION_ERROR", stdout: "", stderr: String(result.error.message || "") };
  return { ok: result.status === 0, status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}
function version(command, args = ["--version"]) {
  const result = run(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
  return (result.stdout || result.stderr).trim().split(/\r?\n/)[0].slice(0, 64) || "unknown";
}
async function walk(dir) {
  const out = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new Error("SKILL_BUNDLE_SYMLINK_REJECTED");
      if (stat.isDirectory()) await visit(full);
      else if (stat.isFile()) out.push(full);
      if (out.length > MAX_FILES) throw new Error("SKILL_BUNDLE_FILE_LIMIT_EXCEEDED");
    }
  }
  await visit(dir);
  return out.sort();
}
function parseJson(file) {
  try { return JSON.parse(requireText(file)); } catch { return null; }
}
let jsonCache = new Map();
function requireText(file) {
  return jsonCache.get(file);
}
async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}
function sarifFindings(sarif, candidatePath) {
  const findings = [];
  for (const result of sarif?.runs?.flatMap(run => run.results || []) || []) {
    const locations = result.locations || [];
    const relevant = locations.some(location => {
      const uri = decodeURIComponent(String(location.physicalLocation?.artifactLocation?.uri || "").replace(/\\/g, "/"));
      return uri === candidatePath || uri.startsWith(candidatePath.replace(/\/SKILL\.md$/i, "") + "/");
    });
    if (!relevant) continue;
    const rule = (sarif.runs || []).flatMap(run => run.tool?.driver?.rules || []).find(item => item.id === result.ruleId);
    const rawSeverity = result.properties?.["security-severity"] ?? rule?.properties?.["security-severity"] ?? result.level;
    findings.push({ severity: severity(rawSeverity), code: safeCode(result.ruleId || "CODEQL_FINDING") });
  }
  return findings;
}
function semgrepFindings(report) {
  return (Array.isArray(report?.results) ? report.results : []).map(item => ({
    severity: severity(item.extra?.severity || item.severity),
    code: safeCode(item.check_id || item.extra?.metadata?.["cwe"] || "SEMGREP_FINDING")
  }));
}
function gitleaksFindings(report) {
  if (!Array.isArray(report)) return [];
  return report.map(item => ({ severity: "high", code: safeCode(item.RuleID || item.ruleID || "SECRET_LEAK") }));
}
function clamFindings(log) {
  const lines = String(log || "").split(/\r?\n/).filter(line => /\bFOUND\s*$/.test(line));
  return lines.map(() => ({ severity: "critical", code: "CLAMAV_MALWARE_DETECTED" }));
}
function depFindings(value) {
  const found = [];
  const seen = new Set();
  function visit(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
    const arrays = ["vulnerabilities", "findings", "violations", "issues", "packages"];
    for (const key of arrays) {
      const items = node[key];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const id = item.id || item.cve || item.name || item.package || item.purl || key;
        const raw = item.severity || item.cvss?.severity || item.cvssScore || item.score || item.risk;
        const sev = severity(raw);
        if (sev === "info" && key === "packages") continue;
        const code = safeCode(id);
        const unique = sev + ":" + code;
        if (!seen.has(unique)) { seen.add(unique); found.push({ severity: sev, code }); }
      }
    }
    for (const [key, child] of Object.entries(node)) if (!arrays.includes(key)) visit(child, depth + 1);
  }
  visit(value);
  return found;
}
async function scannerResult(scanner, versionValue, operation) {
  try {
    const findings = await operation();
    return { scanner, version: versionValue, status: findings.length ? "findings" : "clean", findings };
  } catch (error) {
    return { scanner, version: versionValue || "unavailable", status: "unavailable", findings: [], error: safeCode(error?.message || "SCANNER_ERROR") };
  }
}
async function listSkillEntrypoints(root) {
  const result = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error("SKILL_ROOT_SYMLINK_REJECTED");
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") result.push(full);
    }
  }
  await visit(root);
  return result.sort();
}
async function scanOne(entrypoint, versions, codeqlSarif) {
  const folder = path.dirname(entrypoint);
  const files = await walk(folder);
  let total = 0;
  const manifest = [];
  for (const file of files) {
    const stat = await lstat(file);
    if (stat.size > MAX_FILE_BYTES) throw new Error("SKILL_BUNDLE_FILE_SIZE_INVALID");
    total += stat.size;
    if (total > MAX_BUNDLE_BYTES) throw new Error("SKILL_BUNDLE_SIZE_LIMIT_EXCEEDED");
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    const blob = run("git", ["hash-object", file], { timeout: 10000, maxBuffer: 1024 * 1024 });
    if (blob.status !== 0 || !/^[a-f0-9]{40}$/.test(blob.stdout.trim())) throw new Error("SKILL_BUNDLE_GIT_HASH_FAILED");
    manifest.push({ file, path: relative, size: stat.size, blobSha: blob.stdout.trim() });
  }
  const main = manifest.find(item => item.file === entrypoint);
  if (!main) throw new Error("SKILL_ENTRYPOINT_MISSING");
  const content = await readFile(entrypoint, "utf8");
  const contentSha256 = sha256(content);
  const bundleManifest = manifest.map(item => item.path + "\0" + item.blobSha + "\0" + item.size).sort().join("\n");
  const bundleSha256 = sha256(bundleManifest);
  const repo = process.env.GITHUB_REPOSITORY || "local/scan";
  const commit = process.env.GITHUB_SHA || run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const id = "ci_" + sha256(path.relative(ROOT, entrypoint)).slice(0, 32);
  const candidate = { id, repository: repo, path: path.relative(ROOT, entrypoint).split(path.sep).join("/"), commit, blobSha: main.blobSha };
  const outDir = path.join(REPORT_ROOT, id);
  await mkdir(outDir, { recursive: true });
  const semgrepPath = path.join(outDir, "semgrep.json");
  const gitleaksPath = path.join(outDir, "gitleaks.json");
  const clamLog = path.join(outDir, "clamav.log");
  const depDir = path.join(outDir, "depscan");
  await mkdir(depDir, { recursive: true });

  const semgrep = await scannerResult("semgrep", versions.semgrep, async () => {
    const result = run("semgrep", ["scan", "--config", "p/security-audit", "--json", "--output", semgrepPath, "--metrics=off", folder], { timeout: 240000 });
    if (result.status !== 0 && result.status !== 1) throw new Error("SEMGREP_EXECUTION_FAILED");
    const report = await readJson(semgrepPath);
    if (!report || !Array.isArray(report.results)) throw new Error("SEMGREP_REPORT_INVALID");
    return semgrepFindings(report);
  });
  const gitleaks = await scannerResult("gitleaks", versions.gitleaks, async () => {
    const result = run("gitleaks", ["dir", folder, "--report-format", "json", "--report-path", gitleaksPath, "--redact", "--no-banner"], { timeout: 180000 });
    if (result.status !== 0 && result.status !== 1) throw new Error("GITLEAKS_EXECUTION_FAILED");
    const report = await readJson(gitleaksPath);
    if (!Array.isArray(report)) throw new Error("GITLEAKS_REPORT_INVALID");
    return gitleaksFindings(report);
  });
  const clamav = await scannerResult("clamav", versions.clamav, async () => {
    const result = run("clamscan", ["--recursive", "--infected", "--no-summary", "--log=" + clamLog, folder], { timeout: 240000 });
    if (result.status !== 0 && result.status !== 1) throw new Error("CLAMAV_EXECUTION_FAILED");
    const log = await readFile(clamLog, "utf8").catch(() => result.stdout + "\n" + result.stderr);
    return clamFindings(log);
  });
  const depscan = await scannerResult("owasp_dep_scan", versions.owasp_dep_scan, async () => {
    const result = run("depscan", ["--src", folder, "--reports-dir", depDir, "--profile", "appsec", "--no-banner"], { timeout: 300000 });
    if (result.status !== 0 && result.status !== 1) throw new Error("OWASP_DEPSCAN_EXECUTION_FAILED");
    const names = await readdir(depDir);
    const jsonFiles = names.filter(name => name.toLowerCase().endsWith(".json"));
    if (!jsonFiles.length) throw new Error("OWASP_DEPSCAN_REPORT_MISSING");
    let findings = [];
    for (const name of jsonFiles) findings.push(...depFindings(await readJson(path.join(depDir, name))));
    return findings;
  });
  const codeql = await scannerResult("codeql", versions.codeql, async () => {
    if (!codeqlSarif) throw new Error("CODEQL_SARIF_MISSING");
    return sarifFindings(codeqlSarif, candidate.path);
  });
  const report = {
    schemaVersion: 1,
    policyVersion: "ceoai-skill-firewall-v1",
    candidate,
    runId: String(process.env.GITHUB_RUN_ID || "local-scan-run"),
    scannedAt: new Date().toISOString(),
    contentSha256,
    bundleSha256,
    scans: [clamav, semgrep, codeql, gitleaks, depscan]
  };
  const evaluated = evaluateSkillSecurityReport(report, {
    expectedContentSha256: contentSha256,
    expectedBundleSha256: bundleSha256,
    expectedCandidate: candidate,
    requiredScanners: REQUIRED_SKILL_SCANNERS,
    requireAttestation: false
  });
  const decision = evaluated.ok ? "SCANNED_CLEAN_PENDING_QUALITY" :
    evaluated.severity === "reject" ? "REJECTED" : "QUARANTINED";
  const output = { candidate, contentSha256, bundleSha256, report, evaluation: evaluated, decision };
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  return output;
}

async function main() {
  await mkdir(REPORT_ROOT, { recursive: true });
  const entrypoints = await listSkillEntrypoints(SKILL_ROOT);
  if (!entrypoints.length) throw new Error("NO_EXTERNAL_SKILL_ENTRYPOINTS_FOUND");
  const versions = {
    clamav: version("clamscan"),
    semgrep: version("semgrep"),
    codeql: version("codeql", ["version"]),
    gitleaks: version("gitleaks", ["version"]),
    owasp_dep_scan: version("depscan", ["--version"])
  };
  const codeqlFile = process.env.CODEQL_SARIF || path.join(REPORT_ROOT, "codeql", "javascript.sarif");
  const codeqlSarif = await readJson(codeqlFile);
  const results = [];
  for (const entrypoint of entrypoints) results.push(await scanOne(entrypoint, versions, codeqlSarif));
  const summary = {
    schemaVersion: 1,
    commit: process.env.GITHUB_SHA || "local",
    scanned: results.length,
    cleanPendingQuality: results.filter(item => item.decision === "SCANNED_CLEAN_PENDING_QUALITY").length,
    quarantined: results.filter(item => item.decision === "QUARANTINED").length,
    rejected: results.filter(item => item.decision === "REJECTED").length,
    results
  };
  await writeFile(path.join(REPORT_ROOT, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ scanned: summary.scanned, cleanPendingQuality: summary.cleanPendingQuality,
    quarantined: summary.quarantined, rejected: summary.rejected }));
  if (summary.quarantined || summary.rejected) process.exitCode = 1;
}
main().catch(error => {
  console.error("Skill security scan failed closed:", error?.message || error);
  process.exitCode = 2;
});
