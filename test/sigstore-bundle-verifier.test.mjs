import test from "node:test";
import assert from "node:assert/strict";
import { createSigstoreBundleAttestationVerifier } from "../src/agent/sigstore-bundle-verifier.mjs";

const report = {
  schemaVersion: 1,
  policyVersion: "ceoai-skill-firewall-v1",
  candidate: { repository: "sasapetric5/CEOAI-WORKER" },
  runId: "42783511303",
  scannedAt: "2026-11-10T08:30:00.000Z",
  contentSha256: "a".repeat(64),
  bundleSha256: "b".repeat(64),
  scans: Array.from({ length: 5 }, (_, i) => ({ scanner: "scanner-" + i })),
  attestation: { envelope: Buffer.from("{}").toString("base64") },
};

const context = {
  policyVersion: "ceoai-skill-firewall-v1",
  contentSha256: report.contentSha256,
  bundleSha256: report.bundleSha256,
  trustedRoot: new TextEncoder().encode(JSON.stringify({
    mediaType: "application/vnd.dev.sigstore.trustedroot+json;version=0.1",
  })),
};

test("Sigstore verifier pins repository, workflow and main ref identity", () => {
  assert.doesNotThrow(() => createSigstoreBundleAttestationVerifier());
  assert.throws(() => createSigstoreBundleAttestationVerifier({
    expectedRepository: "attacker/other",
    expectedWorkflow: "../evil.yml",
    expectedRef: "refs/tags/v1",
  }), /SIGSTORE_EXPECTED_IDENTITY_POLICY_INVALID/);
});

test("Sigstore verifier rejects wrong report binding before parsing bundle", async () => {
  const verify = createSigstoreBundleAttestationVerifier();
  await assert.rejects(
    () => verify({ ...report, candidate: { repository: "attacker/other" } }, context),
    /SIGSTORE_REPORT_BINDING_INVALID/
  );
  await assert.rejects(
    () => verify(report, { ...context, bundleSha256: "c".repeat(64) }),
    /SIGSTORE_REPORT_BINDING_INVALID/
  );
});

test("Sigstore verifier rejects invalid envelope and invalid trusted-root media type", async () => {
  const verify = createSigstoreBundleAttestationVerifier();
  await assert.rejects(
    () => verify({ ...report, attestation: { envelope: "not-base64!" } }, context),
    /SIGSTORE_BUNDLE_BASE64_INVALID/
  );
  await assert.rejects(
    () => verify(report, { ...context, trustedRoot: new TextEncoder().encode("{}") }),
    /SIGSTORE_TRUSTED_ROOT_MEDIA_TYPE_INVALID/
  );
});
