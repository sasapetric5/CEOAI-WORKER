import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REQUIRED_SKILL_SCANNERS } from "../src/agent/skill-security-firewall.mjs";

const outDir = path.resolve(process.env.SIGSTORE_TEST_DIR || ".reports/tuf-sigstore-test");
const repository = process.env.GITHUB_REPOSITORY || "sasapetric5/CEOAI-WORKER";
const commit = process.env.GITHUB_SHA || "0".repeat(40);
const runId = String(process.env.GITHUB_RUN_ID || "local-run-0001");
const content = Buffer.from("CEOAI TUF-to-Sigstore verifier integration fixture\n");
const bundle = Buffer.from("synthetic skill bundle for signed verifier integration\n");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const candidatePath = "security/tuf-worker/testdata/attested-skill/SKILL.md";
const candidate = {
  id: "ci_" + sha256(Buffer.from(candidatePath)).slice(0, 32),
  repository,
  path: candidatePath,
  commit,
  blobSha: "f".repeat(40),
};
const unsigned = {
  schemaVersion: 1,
  policyVersion: "ceoai-skill-firewall-v1",
  candidate,
  runId,
  scannedAt: new Date().toISOString(),
  contentSha256: sha256(content),
  bundleSha256: sha256(bundle),
  scans: REQUIRED_SKILL_SCANNERS.map(scanner => ({
    scanner,
    version: "integration-fixture",
    status: "clean",
    findings: [],
  })),
};
const report = { ...unsigned, attestation: { envelope: "" } };
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "unsigned.json"), JSON.stringify(unsigned, null, 2) + "\n", { mode: 0o600 });
await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log("Prepared deterministic Sigstore verifier fixture for " + repository);
