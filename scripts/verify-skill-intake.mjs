import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MANIFEST = "skills/intake-batch-001.json";
const DEFAULT_REPORT = ".reports/skill-intake-verification.json";
const MAX_BYTES = 256 * 1024;
const CONCURRENCY = 5;

export function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export function scanSkillContent(content) {
  const text = String(content);
  const flags = [];
  const checks = [
    ["credential_access", /\b(process\.env|Deno\.env|secrets?\s+(?:store|manager|file)|API[_ -]?KEY|PRIVATE[_ -]?KEY|credentials?)\b/i],
    ["remote_or_shell_execution", /\b(child_process|execSync|spawnSync|eval\s*\(|new Function\s*\(|subprocess\.(?:run|Popen)|os\.system)\b/i],
    ["download_or_install", /\b(curl\s|wget\s|npm install|pnpm add|pip install|apt-get install|brew install)\b/i],
    ["network_access", /\b(fetch\s*\(|axios\.|https?:\/\/)/i],
    ["shell_script_blocks", /```(?:bash|sh|shell|powershell)\b/i],
    ["external_action_language", /\b(send|publish|purchase|delete|deploy|transfer)\s+(?:an?\s+)?(?:email|message|payment|file|data|application|post|release)\b/i]
  ];
  for (const [name, pattern] of checks) if (pattern.test(text)) flags.push(name);
  return { flags, manual_review_required: true, automated_scan_is_not_a_security_approval: true };
}

export function verifySkillRecord(candidate, content) {
  const bytes = Buffer.byteLength(content, "utf8");
  const actualBlob = gitBlobSha(content);
  const actualHash = createHash("sha256").update(content, "utf8").digest("hex");
  const scan = scanSkillContent(content);
  return {
    id: candidate.id,
    source: candidate.source,
    bytes,
    expected_git_blob_sha: candidate.git_blob_sha ?? null,
    actual_git_blob_sha: actualBlob,
    git_blob_match: Boolean(candidate.git_blob_sha && actualBlob === candidate.git_blob_sha),
    sha256: actualHash,
    ...scan,
    status: candidate.git_blob_sha && actualBlob === candidate.git_blob_sha ? "integrity-verified-manual-review-required" : "integrity-failed"
  };
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "CEOAI-Skill-Intake-Verifier/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const content = await response.text();
      if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new Error(`Source exceeds ${MAX_BYTES} bytes: ${url}`);
      return content;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

export async function verifyManifest(manifest, fetcher = fetchText) {
  if (!manifest || !Array.isArray(manifest.candidates) || manifest.candidates.length === 0) {
    throw new Error("Manifest must contain a non-empty candidates array");
  }
  const ids = manifest.candidates.map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("Manifest contains duplicate candidate IDs");
  const source = manifest.source_snapshot;
  if (!source?.repository || !/^[a-f0-9]{40}$/i.test(source.commit || "")) {
    throw new Error("Manifest source snapshot must pin an owner/repository and 40-character commit SHA");
  }
  const results = await mapLimit(manifest.candidates, CONCURRENCY, async candidate => {
    if (candidate.source?.repository !== source.repository || candidate.source?.ref !== source.commit || !candidate.source?.path) {
      return { id: candidate.id, status: "invalid-source-reference", git_blob_match: false, manual_review_required: true };
    }
    const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${candidate.source.path}`;
    try {
      const content = await fetcher(url);
      return verifySkillRecord(candidate, content);
    } catch (error) {
      return { id: candidate.id, source: candidate.source, status: "fetch-failed", error: String(error), git_blob_match: false, manual_review_required: true };
    }
  });
  const licenseUrl = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/LICENSE`;
  let license;
  try {
    const content = await fetcher(licenseUrl);
    const blob = gitBlobSha(content);
    license = {
      path: "LICENSE",
      expected_git_blob_sha: source.license_file_git_blob_sha ?? null,
      actual_git_blob_sha: blob,
      git_blob_match: Boolean(source.license_file_git_blob_sha && blob === source.license_file_git_blob_sha),
      apache_2_0_header_present: /Apache License\s+Version 2\.0/i.test(content),
      status: /Apache License\s+Version 2\.0/i.test(content) ? "repository-license-file-confirmed" : "license-header-unconfirmed"
    };
  } catch (error) {
    license = { path: "LICENSE", status: "fetch-failed", error: String(error), git_blob_match: false };
  }
  const verified = results.filter(item => item.git_blob_match).length;
  const failed = results.length - verified;
  return {
    schema_version: "1.0.0",
    batch_id: manifest.batch_id,
    source_snapshot: { repository: source.repository, commit: source.commit },
    generated_at: new Date().toISOString(),
    summary: {
      candidates: results.length,
      git_blob_integrity_verified: verified,
      integrity_failed_or_unavailable: failed,
      sha256_generated: results.filter(item => /^[a-f0-9]{64}$/.test(item.sha256 || "")).length,
      flagged_for_manual_security_review: results.filter(item => item.flags?.length).length,
      manual_review_required: results.length,
      license_file_confirmed: Boolean(license.git_blob_match && license.apache_2_0_header_present),
      runtime_enabled: 0
    },
    license,
    results
  };
}

async function main() {
  const manifestPath = resolve(process.argv[2] || DEFAULT_MANIFEST);
  const reportPath = resolve(process.env.SKILL_INTAKE_REPORT || DEFAULT_REPORT);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const report = await verifyManifest(manifest);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Detailed report: ${reportPath}`);
  if (report.summary.integrity_failed_or_unavailable > 0 || !report.summary.license_file_confirmed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
