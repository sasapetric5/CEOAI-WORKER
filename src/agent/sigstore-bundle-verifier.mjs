import { bundleFromJSON } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { toSignedEntity, toTrustMaterial, Verifier } from "@sigstore/verify";

const DEFAULT_REPOSITORY = "sasapetric5/CEOAI-WORKER";
const DEFAULT_WORKFLOW = "skill-security-firewall.yml";
const DEFAULT_REF = "refs/heads/main";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function decodeEnvelope(value) {
  if (typeof value !== "string" || value.length < 4 ||
      value.length > Math.ceil(MAX_BUNDLE_BYTES * 4 / 3) + 8 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("SIGSTORE_BUNDLE_BASE64_INVALID");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_BUNDLE_BYTES || bytes.toString("base64") !== value) {
    throw new Error("SIGSTORE_BUNDLE_SIZE_OR_ENCODING_INVALID");
  }
  return bytes;
}

function unsignedPayload(report) {
  // Preserve the exact field order and JSON formatting used by
  // scripts/skill-security-scan-batch.mjs before cosign sign-blob.
  const payload = {
    schemaVersion: report.schemaVersion,
    policyVersion: report.policyVersion,
    candidate: report.candidate,
    runId: report.runId,
    scannedAt: report.scannedAt,
    contentSha256: report.contentSha256,
    bundleSha256: report.bundleSha256,
    scans: report.scans,
  };
  const bytes = Buffer.from(JSON.stringify(payload, null, 2) + "\n", "utf8");
  if (!bytes.length || bytes.length > MAX_PAYLOAD_BYTES) throw new Error("SIGSTORE_PAYLOAD_SIZE_INVALID");
  return bytes;
}

export function createSigstoreBundleAttestationVerifier({
  expectedRepository = DEFAULT_REPOSITORY,
  expectedWorkflow = DEFAULT_WORKFLOW,
  expectedRef = DEFAULT_REF,
} = {}) {
  if (typeof expectedRepository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expectedRepository) ||
      typeof expectedWorkflow !== "string" || !/^[A-Za-z0-9_.-]+\.yml$/.test(expectedWorkflow) ||
      typeof expectedRef !== "string" || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(expectedRef)) {
    throw new TypeError("SIGSTORE_EXPECTED_IDENTITY_POLICY_INVALID");
  }

  const identity = new RegExp(
    "^https://github\\.com/" + escapeRegex(expectedRepository) +
    "/\\.github/workflows/" + escapeRegex(expectedWorkflow) +
    "@" + escapeRegex(expectedRef) + "$"
  );

  return async function verifySigstoreBundle(report, context = {}) {
    if (!report || report.schemaVersion !== 1 ||
        report.policyVersion !== context.policyVersion ||
        !context.candidate ||
        ["id", "repository", "path", "commit", "blobSha"].some(key =>
          report.candidate?.[key] !== context.candidate[key]) ||
        report.contentSha256 !== context.contentSha256 ||
        report.bundleSha256 !== context.bundleSha256 ||
        !Array.isArray(report.scans) || report.scans.length !== 5 ||
        !(context.trustedRoot instanceof Uint8Array) ||
        context.trustedRoot.byteLength < 1 || context.trustedRoot.byteLength > MAX_BUNDLE_BYTES) {
      throw new Error("SIGSTORE_REPORT_BINDING_INVALID");
    }

    const trustedRootJSON = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(context.trustedRoot));
    if (trustedRootJSON.mediaType !== "application/vnd.dev.sigstore.trustedroot+json;version=0.1") {
      throw new Error("SIGSTORE_TRUSTED_ROOT_MEDIA_TYPE_INVALID");
    }
    const trustedRoot = TrustedRoot.fromJSON(trustedRootJSON);
    const bundleBytes = decodeEnvelope(report.attestation?.envelope);
    const bundleJSON = JSON.parse(bundleBytes.toString("utf8"));
    const bundle = bundleFromJSON(bundleJSON);

    if (bundle.content?.$case !== "messageSignature" ||
        !["x509CertificateChain", "certificate"].includes(bundle.verificationMaterial?.content?.$case) ||
        !Array.isArray(bundle.verificationMaterial?.tlogEntries) ||
        bundle.verificationMaterial.tlogEntries.length < 1) {
      throw new Error("SIGSTORE_BUNDLE_CONTENT_OR_CERTIFICATE_INVALID");
    }

    const payload = unsignedPayload(report);
    const verifier = new Verifier(toTrustMaterial(trustedRoot), {
      tlogThreshold: 1,
      ctlogThreshold: 1,
      timestampThreshold: 0, // Rekor integrated time is required; RFC3161 timestamp authorities are optional.
    });
    verifier.verify(toSignedEntity(bundle, payload), {
      subjectAlternativeName: identity,
      extensions: { issuer: OIDC_ISSUER },
    });
    return true;
  };
}
