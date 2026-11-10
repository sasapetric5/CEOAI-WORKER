import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCloudflareSigstoreTufFirewall } from "../src/agent/cloudflare-sigstore-tuf-firewall.mjs";
import { REQUIRED_SKILL_SCANNERS } from "../src/agent/skill-security-firewall.mjs";

const wasmPath = new URL("../security/tuf-worker/target/wasm32-unknown-unknown/release/ceoai_sigstore_tuf_worker.wasm", import.meta.url);
const wasmBytes = await readFile(wasmPath);
const module = await WebAssembly.compile(wasmBytes);
const imports = WebAssembly.Module.imports(module);
assert.deepEqual(imports, [
  { module: "env", name: "ceoai_getrandom_fill", kind: "function" },
], "WASM must expose only the explicit WebCrypto entropy host import");

const base = new URL("../security/tuf-worker/testdata/", import.meta.url);
const read = async name => new Uint8Array(await readFile(new URL(name, base)));
const b64 = bytes => Buffer.from(bytes).toString("base64");
const trustedRootBytes = await read("trusted_root.json");
const validInputs = {
  metadata: {
    "11.root.json": b64(await read("11.root.json")),
    "12.root.json": b64(await read("12.root.json")),
    "13.root.json": b64(await read("13.root.json")),
    "14.root.json": b64(await read("14.root.json")),
    "15.root.json": b64(await read("15.root.json")),
    "16.root.json": b64(await read("16.root.json")),
    "timestamp.json": b64(await read("timestamp.json")),
    "166.snapshot.json": b64(await read("snapshot.json")),
    "14.targets.json": b64(await read("targets.json")),
  },
  targets: {
    "6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66.trusted_root.json": b64(trustedRootBytes),
  },
  targetPath: "trusted_root.json",
};

function makeDurableNamespace() {
  const state = { revision: 0, rootVersion: 0, cache: {} };
  const namespace = {
    idFromName(name) { assert.equal(name, "sigstore-tuf-global"); return name; },
    get() {
      return {
        async fetch(url, init) {
          const path = new URL(url).pathname;
          if (path === "/tuf/cache/read") return Response.json({
            ok: true, revision: state.revision, rootVersion: state.rootVersion, cache: state.cache,
          });
          if (path === "/tuf/cache/commit") {
            const input = JSON.parse(init.body);
            if (input.expectedRevision !== state.revision) {
              return Response.json({ ok: false, code: "TUF_CACHE_REVISION_CONFLICT" }, { status: 409 });
            }
            if (input.rootVersion < state.rootVersion) {
              return Response.json({ ok: false, code: "TUF_ROOT_ROLLBACK_REJECTED" }, { status: 409 });
            }
            state.revision++;
            state.rootVersion = input.rootVersion;
            state.cache = input.cache;
            return Response.json({ ok: true, revision: state.revision, rootVersion: state.rootVersion });
          }
          return new Response("Not Found", { status: 404 });
        },
      };
    },
  };
  return { namespace, state };
}

function makeReport(candidate, contentSha256, bundleSha256) {
  return {
    schemaVersion: 1,
    policyVersion: "ceoai-skill-firewall-v1",
    candidate,
    runId: "wasm-integration-0001",
    scannedAt: new Date().toISOString(),
    attestation: { envelope: "trusted-ci-attestation-envelope" },
    contentSha256,
    bundleSha256,
    scans: REQUIRED_SKILL_SCANNERS.map(scanner => ({
      scanner, version: "1.0.0", status: "clean", findings: [],
    })),
  };
}

async function runFirewallIntegration({ tamperTimestamp = false } = {}) {
  const { namespace, state } = makeDurableNamespace();
  const candidate = {
    id: tamperTimestamp ? "skill_tuf_fail" : "skill_tuf_ok",
    repository: "trusted/skills",
    path: "skills/demo/SKILL.md",
    commit: "b".repeat(40),
    blobSha: "c".repeat(40),
  };
  const content = "candidate remains inert data";
  const contentSha256 = "a".repeat(64);
  const bundleSha256 = "d".repeat(64);
  const report = makeReport(candidate, contentSha256, bundleSha256);
  const failures = [];
  let sigstoreVerifierCalled = false;
  const inputs = structuredClone(validInputs);
  if (tamperTimestamp) {
    const bytes = Buffer.from(inputs.metadata["timestamp.json"], "base64");
    bytes[20] ^= 1;
    inputs.metadata["timestamp.json"] = bytes.toString("base64");
  }

  const firewall = await createCloudflareSigstoreTufFirewall({
    env: { SECURITY_DO: namespace },
    wasmModule: module,
    scanCandidate: async scanInput => {
      assert.equal(scanInput.executeCandidateCode, false);
      assert.equal(scanInput.networkAccessForCandidate, false);
      assert.equal(scanInput.secretAccessForCandidate, false);
      return report;
    },
    fetchInputs: async () => inputs,
    skillLifecycle: {
      async recordFailure(id, failure) {
        failures.push({ id, ...failure });
        return { ok: true };
      },
    },
    verifyAttestation: async (_report, context) => {
      sigstoreVerifierCalled = true;
      assert.deepEqual(Buffer.from(context.trustedRoot), Buffer.from(trustedRootBytes));
      assert.equal(context.trustedRootVersion, 16);
      assert.equal(context.trustedRootCacheRevision, 1);
      return true;
    },
  });

  const result = await firewall.scan({
    candidate, content, files: ["SKILL.md"], contentSha256, bundleSha256,
  });
  return { result, state, failures, sigstoreVerifierCalled };
}

const accepted = await runFirewallIntegration();
assert.equal(accepted.result.ok, true);
assert.equal(accepted.result.status, "clean");
assert.equal(accepted.state.revision, 1);
assert.equal(accepted.state.rootVersion, 16);
assert.ok(accepted.state.cache["root.json"]);
assert.equal(accepted.sigstoreVerifierCalled, true);
assert.deepEqual(accepted.failures, []);

const rejected = await runFirewallIntegration({ tamperTimestamp: true });
assert.equal(rejected.result.ok, false);
assert.equal(rejected.result.code, "TUF_METADATA_VERIFICATION_FAILED");
assert.equal(rejected.state.revision, 0, "failed TUF verification must never commit cache");
assert.equal(rejected.sigstoreVerifierCalled, false, "Sigstore verifier must not run without verified TUF root");
assert.equal(rejected.failures.length, 1);
assert.equal(rejected.failures[0].id, "skill_tuf_fail");
assert.equal(rejected.failures[0].severity, "quarantine");

console.log("Real TUF WASM → Security DO cache → skill firewall → Sigstore verifier handoff passed.");
console.log("Failure path passed: invalid TUF signature → no cache commit → no Sigstore call → automatic quarantine.");
