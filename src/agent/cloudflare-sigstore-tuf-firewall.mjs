import { createCloudflareTufMetadataStore } from "./cloudflare-tuf-metadata-store.mjs";
import { createSkillSecurityFirewall } from "./skill-security-firewall.mjs";
import { createSigstoreBundleAttestationVerifier } from "./sigstore-bundle-verifier.mjs";
import {
  createSigstoreTufTrustRootProvider,
  instantiateWasmTufVerifier,
} from "./sigstore-tuf-trust-root-provider.mjs";

// Compose the existing SECURITY_DO cache, bounded Sigstore repository fetcher,
// Rust/WASM TUF verifier, attestation verifier, and persistent skill quarantine.
export async function createCloudflareSigstoreTufFirewall({
  env,
  wasmModule,
  scanCandidate,
  verifyAttestation = createSigstoreBundleAttestationVerifier(),
  skillLifecycle,
  fetchInputs,
  now,
} = {}) {
  if (!env?.SECURITY_DO) throw new TypeError("SECURITY_DO_BINDING_REQUIRED");
  if (!skillLifecycle || typeof skillLifecycle.recordFailure !== "function") {
    throw new TypeError("SKILL_LIFECYCLE_QUARANTINE_ADAPTER_REQUIRED");
  }
  if (typeof scanCandidate !== "function" || typeof verifyAttestation !== "function") {
    throw new TypeError("SKILL_FIREWALL_ADAPTERS_REQUIRED");
  }

  const metadataStore = createCloudflareTufMetadataStore(env.SECURITY_DO);
  const verifyTuf = await instantiateWasmTufVerifier(wasmModule);
  const trustRootProvider = createSigstoreTufTrustRootProvider({
    metadataStore,
    verifyTuf,
    ...(fetchInputs ? { fetchInputs } : {}),
    ...(now ? { now } : {}),
    onFailure: async ({ candidateId, stage, code }) => {
      if (typeof candidateId !== "string" || !/^[a-z][a-z0-9_]{0,47}$/.test(candidateId)) {
        throw new Error("TUF_CANDIDATE_ID_REQUIRED_FOR_QUARANTINE");
      }
      const isolated = await skillLifecycle.recordFailure(candidateId, {
        stage: "tuf_" + stage,
        code,
        severity: "quarantine",
      });
      if (isolated?.ok !== true) throw new Error("TUF_FAILURE_QUARANTINE_PERSISTENCE_FAILED");
    },
  });

  return createSkillSecurityFirewall({
    scanCandidate,
    verifyAttestation,
    trustRootProvider,
  });
}
