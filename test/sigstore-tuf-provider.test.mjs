import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fetchSigstoreTufInputs } from "../src/agent/sigstore-tuf-repository-fetcher.mjs";
import { createSigstoreTufTrustRootProvider, createWasmTufVerifier } from "../src/agent/sigstore-tuf-trust-root-provider.mjs";

const targetBytes = new TextEncoder().encode('{"mediaType":"application/vnd.dev.sigstore.trustedroot+json;version=0.1"}');
const targetBase64 = Buffer.from(targetBytes).toString("base64");
const verified = {
  ok: true,
  code: "TUF_CHAIN_VERIFIED",
  root_version: 17,
  timestamp_version: 831,
  snapshot_version: 167,
  targets_version: 15,
  verified_target_base64: targetBase64,
  cache: {
    "root.json": Buffer.from("root17").toString("base64"),
    "root_history/17.root.json": Buffer.from("root17").toString("base64"),
    "timestamp.json": Buffer.from("timestamp831").toString("base64"),
    "167.snapshot.json": Buffer.from("snapshot167").toString("base64"),
    "15.targets.json": Buffer.from("targets15").toString("base64"),
  },
};

function dependencies(overrides = {}) {
  const events = [];
  const snapshot = {
    revision: 4,
    rootVersion: 16,
    cache: { "root.json": Buffer.from("cached-root16").toString("base64") },
  };
  const metadataStore = {
    async load() { events.push("cache_read"); return snapshot; },
    async commit(input) {
      events.push("cache_commit");
      assert.equal(input.expectedRevision, snapshot.revision);
      assert.equal(input.rootVersion, 17);
      return { revision: 5, rootVersion: 17 };
    },
  };
  const fetchInputs = async ({ cache }) => {
    events.push("metadata_fetch");
    assert.deepEqual(cache, snapshot.cache);
    return { metadata: { "timestamp.json": "dGVzdA==" }, targets: {}, targetPath: "trusted_root.json" };
  };
  const verifyTuf = input => {
    events.push("tuf_verify");
    assert.deepEqual(input.cache, snapshot.cache);
    assert.equal(input.target_path, "trusted_root.json");
    assert.ok(input.metadata["timestamp.json"]);
    return verified;
  };
  return {
    events, snapshot, metadataStore, fetchInputs, verifyTuf,
    ...overrides,
  };
}

test("TUF provider reads DO cache, fetches metadata, verifies WASM result, then commits atomically", async () => {
  const deps = dependencies();
  const provider = createSigstoreTufTrustRootProvider({ ...deps, now: () => 1_800_000_000 });
  const result = await provider.loadTrustedRoot({ candidateId: "ci_example" });
  assert.deepEqual(deps.events, ["cache_read", "metadata_fetch", "tuf_verify", "cache_commit"]);
  assert.equal(result.ok, true);
  assert.equal(result.rootVersion, 17);
  assert.equal(result.cacheRevision, 5);
  assert.deepEqual(result.target, targetBytes);
});

test("TUF provider never commits cache when metadata verification fails and quarantines candidate", async () => {
  const failures = [];
  const deps = dependencies({
    verifyTuf() { throw new Error("TUF_METADATA_VERIFICATION_FAILED"); },
  });
  const provider = createSigstoreTufTrustRootProvider({
    ...deps,
    onFailure: async failure => failures.push(failure),
  });
  await assert.rejects(() => provider.loadTrustedRoot({ candidateId: "ci_untrusted" }), /TUF_METADATA_VERIFICATION_FAILED/);
  assert.deepEqual(deps.events, ["cache_read", "metadata_fetch", "cache_commit"].filter(x => x !== "cache_commit"));
  assert.deepEqual(failures, [{ candidateId: "ci_untrusted", stage: "tuf_verify", code: "TUF_METADATA_VERIFICATION_FAILED" }]);
});

test("TUF provider rejects a cache commit conflict and does not return the target", async () => {
  const failures = [];
  const deps = dependencies({
    metadataStore: {
      async load() { deps.events.push("cache_read"); return deps.snapshot; },
      async commit() { deps.events.push("cache_commit"); throw new Error("TUF_CACHE_REVISION_CONFLICT"); },
    },
  });
  const provider = createSigstoreTufTrustRootProvider({ ...deps, onFailure: async x => failures.push(x) });
  await assert.rejects(() => provider.loadTrustedRoot(), /TUF_CACHE_REVISION_CONFLICT/);
  assert.deepEqual(deps.events, ["cache_read", "metadata_fetch", "tuf_verify", "cache_commit"]);
  assert.equal(failures[0].stage, "cache_commit");
});

test("WASM ABI adapter marshals JSON input and decodes packed pointer/length output", () => {
  const memory = new WebAssembly.Memory({ initial: 2 });
  let cursor = 1024;
  const alloc = length => {
    const pointer = cursor;
    cursor += length + 16;
    if (cursor > memory.buffer.byteLength) memory.grow(2);
    return pointer;
  };
  const free = () => {};
  const verify_tuf = (pointer, length) => {
    const input = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, pointer, length)));
    assert.equal(input.target_path, "trusted_root.json");
    const bytes = new TextEncoder().encode(JSON.stringify(verified));
    const outPointer = alloc(bytes.length);
    new Uint8Array(memory.buffer, outPointer, bytes.length).set(bytes);
    return (BigInt(outPointer) << 32n) | BigInt(bytes.length);
  };
  const verify = createWasmTufVerifier({ exports: { memory, alloc, free_buffer: free, verify_tuf } });
  const result = verify({ target_path: "trusted_root.json" });
  assert.equal(result.ok, true);
  assert.equal(result.root_version, 17);
});

test("WASM ABI adapter rejects a malformed packed return value", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const verify = createWasmTufVerifier({
    exports: { memory, alloc: () => 8, free_buffer() {}, verify_tuf: () => 7 },
  });
  assert.throws(() => verify({ target_path: "trusted_root.json" }), /TUF_WASM_ABI_INVALID_POINTER/);
});


test("Sigstore TUF fetcher requests only fixed-host sequential roots and hash-addressed target", async () => {
  const target = Buffer.from('{"trusted":"root"}');
  const hash = createHash("sha256").update(target).digest("hex");
  const fixtures = new Map([
    ["https://tuf-repo-cdn.sigstore.dev/17.root.json", Buffer.from('{"signed":{"version":17}}')],
    ["https://tuf-repo-cdn.sigstore.dev/timestamp.json", Buffer.from(JSON.stringify({ signed: { meta: { "snapshot.json": { version: 12 } } } }))],
    ["https://tuf-repo-cdn.sigstore.dev/12.snapshot.json", Buffer.from(JSON.stringify({ signed: { meta: { "targets.json": { version: 13 } } } }))],
    ["https://tuf-repo-cdn.sigstore.dev/13.targets.json", Buffer.from(JSON.stringify({ signed: { targets: { "trusted_root.json": { length: target.length, hashes: { sha256: hash } } } } }))],
    ["https://tuf-repo-cdn.sigstore.dev/targets/" + hash + ".trusted_root.json", target],
  ]);
  const requested = [];
  const result = await fetchSigstoreTufInputs({
    fetchImpl: async (url, options) => {
      requested.push(url);
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      if (url.endsWith("/18.root.json")) return new Response(null, { status: 404 });
      const bytes = fixtures.get(url);
      assert.ok(bytes, "unexpected URL " + url);
      return new Response(bytes, { status: 200 });
    },
  });
  assert.equal(result.targetPath, "trusted_root.json");
  assert.deepEqual(requested, [
    "https://tuf-repo-cdn.sigstore.dev/17.root.json",
    "https://tuf-repo-cdn.sigstore.dev/18.root.json",
    "https://tuf-repo-cdn.sigstore.dev/timestamp.json",
    "https://tuf-repo-cdn.sigstore.dev/12.snapshot.json",
    "https://tuf-repo-cdn.sigstore.dev/13.targets.json",
    "https://tuf-repo-cdn.sigstore.dev/targets/" + hash + ".trusted_root.json",
  ]);
  assert.equal(Buffer.from(result.targets[hash + ".trusted_root.json"], "base64").toString(), target.toString());
});

test("Sigstore TUF fetcher rejects redirects and oversized root metadata", async () => {
  await assert.rejects(() => fetchSigstoreTufInputs({
    fetchImpl: async url => {
      const response = new Response("redirected", { status: 200 });
      Object.defineProperty(response, "url", { value: "https://attacker.invalid/root.json" });
      return response;
    },
  }), /TUF_REMOTE_REDIRECT_REJECTED/);

  await assert.rejects(() => fetchSigstoreTufInputs({
    fetchImpl: async () => new Response(new Uint8Array(512 * 1024 + 1), { status: 200 }),
  }), /TUF_REMOTE_RESPONSE_TOO_LARGE_ROOT_17/);
});
