import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wasmPath = new URL("../security/tuf-worker/target/wasm32-unknown-unknown/release/ceoai_sigstore_tuf_worker.wasm", import.meta.url);
const wasmBytes = await readFile(wasmPath);
const module = await WebAssembly.compile(wasmBytes);
const imports = WebAssembly.Module.imports(module);
assert.deepEqual(imports, [
  { module: "env", name: "ceoai_getrandom_fill", kind: "function" },
], "WASM must expose only the explicit WebCrypto entropy host import");
let memory;
const instance = await WebAssembly.instantiate(module, {
  env: {
    ceoai_getrandom_fill(pointer, length) {
      assert.ok(memory, "WASM memory must be initialized before entropy use");
      assert.ok(Number.isInteger(pointer) && Number.isInteger(length) && pointer >= 0 && length >= 0 && length <= 1024 * 1024);
      const view = new Uint8Array(memory.buffer, pointer, length);
      for (let offset = 0; offset < view.length; offset += 65536) {
        globalThis.crypto.getRandomValues(view.subarray(offset, Math.min(offset + 65536, view.length)));
      }
    },
  },
});
memory = instance.exports.memory;
const { alloc, free_buffer, verify_tuf } = instance.exports;
const required = ["memory", "alloc", "free_buffer", "verify_tuf"];
for (const name of required) {
  assert.ok(name in instance.exports, "WASM export missing: " + name);
}
const base = new URL("../security/tuf-worker/testdata/", import.meta.url);
const read = async name => new Uint8Array(await readFile(new URL(name, base)));
const b64 = bytes => Buffer.from(bytes).toString("base64");
const input = {
  metadata: {
    "timestamp.json": b64(await read("timestamp.json")),
    "166.snapshot.json": b64(await read("snapshot.json")),
    "14.targets.json": b64(await read("targets.json")),
  },
  targets: {
    "6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66.trusted_root.json": b64(await read("trusted_root.json")),
  },
  target_path: "trusted_root.json",
};
const encoded = new TextEncoder().encode(JSON.stringify(input));
const inputPointer = alloc(encoded.byteLength);
new Uint8Array(memory.buffer, inputPointer, encoded.byteLength).set(encoded);
let outputPointer = 0;
let outputLength = 0;
try {
  const packed = verify_tuf(inputPointer, encoded.byteLength);
  assert.equal(typeof packed, "bigint", "verify_tuf must return packed u64 pointer/length");
  outputPointer = Number((packed >> 32n) & 0xffffffffn);
  outputLength = Number(packed & 0xffffffffn);
  assert.ok(outputPointer > 0 && outputLength > 0 && outputLength <= 16 * 1024 * 1024);
  const output = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(memory.buffer, outputPointer, outputLength)
  ));
  assert.equal(output.ok, true, output.code);
  assert.equal(output.code, "TUF_CHAIN_VERIFIED");
  assert.equal(output.root_version, 16);
  assert.equal(output.timestamp_version, 830);
  assert.equal(output.snapshot_version, 166);
  assert.equal(output.targets_version, 14);
  assert.ok(output.cache["root.json"]);
  assert.ok(output.verified_target_base64);
  console.log("TUF WASM ABI integration passed: " + JSON.stringify({
    imports, exports: required, rootVersion: output.root_version,
    timestampVersion: output.timestamp_version, snapshotVersion: output.snapshot_version,
    targetsVersion: output.targets_version,
  }));
} finally {
  if (outputPointer && outputLength) free_buffer(outputPointer, outputLength);
  free_buffer(inputPointer, encoded.byteLength);
}
