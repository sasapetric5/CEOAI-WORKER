import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST = "skills/intake-batch-001.json";
const REPORT = ".reports/skill-intake-verification.json";
const MAX_BYTES = 256 * 1024;
const FETCH_CONCURRENCY = 5;

export function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export function scanSkillContent(content) {
  const patterns = {
    credential_access: /\b(process\.env|Deno\.env|API[_ -]?KEY|PRIVATE[_ -]?KEY|credentials?)\b/i,
    code_execution: /\b(child_process|execSync|spawnSync|eval\s*\(|new Function\s*\(|subprocess\.(?:run|Popen)|os\.system)\b/i,
    install_commands: /\b(curl\s|wget\s|npm install|pnpm add|pip install|apt-get install)\b/i,
    network_access: /\b(fetch\s*\(|axios\.|https?:\/\/)/i,
    shell_blocks: /```(?:bash|sh|shell|powershell)\b/i,
    external_actions: /\b(send|publish|purchase|delete|deploy|transfer)\s+(?:an?\s+)?(?:email|message|payment|file|data|application|post|release)\b/i
  };
  return {
    flags: Object.entries(patterns).filter(([, pattern]) => pattern.test(String(content))).map(([name]) => name),
    manual_review_required: true,
    automated_scan_is_not_a_security_approval: true
  };
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

export async function verifyManifest(manifest, fetcher = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "CEOAI-Skill-Intake-Verifier/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BYTES) throw new Error("Source exceeds size limit");
  return body;
}) {
  const source = manifest?.source_snapshot;
  const candidates = manifest?.candidates;
  if (!source?.repository || !/^[a-f0-9]{40}$/i.test(source.commit || "") || !Array.isArray(candidates) || !candidates.length) {
    throw new Error("Invalid manifest: pinned repository, 40-character commit and candidates are required");
  }
  if (new Set(candidates.map(item => item.id)).size !== candidates.length) throw new Error("Duplicate candidate IDs");
  const seenPaths = new Set();
  const results = await mapLimit(candidates, FETCH_CONCURRENCY, async candidate => {
    const sourcePath = String(candidate.source?.path || "");
    if (candidate.source?.repository !== source.repository || candidate.source?.ref !== source.commit ||
        !/^skills\/[a-z0-9][a-z0-9._-]*\/SKILL\.md$/i.test(sourcePath) ||
        !/^[a-f0-9]{40}$/i.test(candidate.git_blob_sha || "")) {
      return { id: candidate.id, status: "invalid-source-reference-or-blob-pin", git_blob_match: false, manual_review_required: true };
    }
    if (seenPaths.has(sourcePath)) {
      return { id: candidate.id, status: "duplicate-source-path", git_blob_match: false, manual_review_required: true };
    }
    seenPaths.add(sourcePath);
    const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${candidate.source.path}`;
    try {
      const body = await fetcher(url);
      const blob = gitBlobSha(body);
      const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
      const scan = scanSkillContent(body);
      return {
        id: candidate.id, source: candidate.source, bytes: Buffer.byteLength(body, "utf8"),
        expected_git_blob_sha: candidate.git_blob_sha ?? null, actual_git_blob_sha: blob,
        git_blob_match: Boolean(candidate.git_blob_sha && blob === candidate.git_blob_sha),
        sha256, ...scan,
        status: candidate.git_blob_sha && blob === candidate.git_blob_sha ? "integrity-verified-manual-review-required" : "integrity-failed"
      };
    } catch (error) {
      return { id: candidate.id, source: candidate.source, status: "fetch-failed", error: String(error), git_blob_match: false, manual_review_required: true };
    }
  });
  let license = { status: "unverified", git_blob_match: false };
  try {
    const body = await fetcher(`https://raw.githubusercontent.com/${source.repository}/${source.commit}/LICENSE`);
    const blob = gitBlobSha(body);
    license = {
      expected_git_blob_sha: source.license_file_git_blob_sha ?? null,
      actual_git_blob_sha: blob,
      git_blob_match: Boolean(source.license_file_git_blob_sha && blob === source.license_file_git_blob_sha),
      apache_2_0_header_present: /Apache License\s+Version 2\.0/i.test(body),
      status: /Apache License\s+Version 2\.0/i.test(body) ? "repository-license-file-confirmed" : "license-header-unconfirmed"
    };
  } catch (error) { license = { status: "fetch-failed", error: String(error), git_blob_match: false }; }
  const matched = results.filter(item => item.git_blob_match).length;
  return {
    schema_version: "1.0.0", batch_id: manifest.batch_id,
    source_snapshot: { repository: source.repository, commit: source.commit },
    generated_at: new Date().toISOString(),
    summary: {
      candidates: results.length, git_blob_integrity_verified: matched,
      integrity_failed_or_unavailable: results.length - matched,
      sha256_generated: results.filter(item => item.sha256).length,
      flagged_for_manual_security_review: results.filter(item => item.flags?.length).length,
      manual_review_required: results.length, license_file_confirmed: Boolean(license.git_blob_match && license.apache_2_0_header_present),
      runtime_enabled: 0
    },
    license, results
  };
}

async function main() {
  const manifest = JSON.parse(await readFile(resolve(process.argv[2] || MANIFEST), "utf8"));
  const report = await verifyManifest(manifest);
  const output = resolve(process.env.SKILL_INTAKE_REPORT || REPORT);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${output}`);
  if (report.summary.integrity_failed_or_unavailable || !report.summary.license_file_confirmed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
