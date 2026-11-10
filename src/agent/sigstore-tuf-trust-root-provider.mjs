import {
  fetchSigstoreTufInputs,
  SIGSTORE_TUF_BOOTSTRAP_ROOT_VERSION,
} from "./sigstore-tuf-repository-fetcher.mjs";

const MAX_WASM_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_WASM_OUTPUT_BYTES = 16 * 1024 * 1024;

function decodeBase64(value) {
  if (typeof value !== "string" || value.length > MAX_WASM_OUTPUT_BYTES * 2 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("TUF_VERIFIER_OUTPUT_INVALID");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readPackedPointer(value) {
  if (typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn) {
    throw new Error("TUF_WASM_ABI_INVALID_POINTER");
  }
  return {
    pointer: Number((value >> 32n) & 0xffffffffn),
    length: Number(value & 0xffffffffn),
  };
}

export function createWasmTufVerifier(instance) {
  const exports = instance?.exports;
  if (!exports?.memory || typeof exports.alloc !== "function" ||
      typeof exports.free_buffer !== "function" || typeof exports.verify_tuf !== "function") {
    throw new TypeError("TUF_WASM_ABI_UNAVAILABLE");
  }
  return function verifyTuf(input) {
    const encoded = new TextEncoder().encode(JSON.stringify(input));
    if (!encoded.byteLength || encoded.byteLength > MAX_WASM_INPUT_BYTES) {
      throw new Error("TUF_WASM_INPUT_TOO_LARGE");
    }
    const inputPointer = exports.alloc(encoded.byteLength);
    if (!Number.isSafeInteger(inputPointer) || inputPointer <= 0) {
      throw new Error("TUF_WASM_ALLOC_FAILED");
    }
    let outputPointer = 0;
    let outputLength = 0;
    try {
      new Uint8Array(exports.memory.buffer, inputPointer, encoded.byteLength).set(encoded);
      const packed = readPackedPointer(exports.verify_tuf(inputPointer, encoded.byteLength));
      outputPointer = packed.pointer;
      outputLength = packed.length;
      if (!outputPointer || !outputLength || outputLength > MAX_WASM_OUTPUT_BYTES ||
          outputPointer + outputLength > exports.memory.buffer.byteLength) {
        throw new Error("TUF_WASM_OUTPUT_BOUNDS_INVALID");
      }
      const outputBytes = new Uint8Array(exports.memory.buffer, outputPointer, outputLength).slice();
      let result;
      try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(outputBytes)); }
      catch { throw new Error("TUF_WASM_OUTPUT_INVALID_JSON"); }
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("TUF_WASM_OUTPUT_INVALID");
      }
      return result;
    } finally {
      if (outputPointer && outputLength) exports.free_buffer(outputPointer, outputLength);
      exports.free_buffer(inputPointer, encoded.byteLength);
    }
  };
}

export async function instantiateWasmTufVerifier(module, {
  cryptoProvider = globalThis.crypto,
  imports = {},
} = {}) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError("TUF_WASM_MODULE_REQUIRED");
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== "function") {
    throw new TypeError("TUF_WEBCRYPTO_REQUIRED");
  }
  let memory;
  const hostEntropy = (pointer, length) => {
    if (!memory || !Number.isSafeInteger(pointer) || !Number.isSafeInteger(length) ||
        pointer < 0 || length < 0 || length > 1024 * 1024 ||
        pointer + length > memory.buffer.byteLength) {
      throw new Error("TUF_WASM_ENTROPY_BOUNDS_INVALID");
    }
    const view = new Uint8Array(memory.buffer, pointer, length);
    for (let offset = 0; offset < view.length; offset += 65536) {
      cryptoProvider.getRandomValues(view.subarray(offset, Math.min(offset + 65536, view.length)));
    }
  };
  const envImports = { ...(imports.env || {}), ceoai_getrandom_fill: hostEntropy };
  const instantiated = await WebAssembly.instantiate(module, { ...imports, env: envImports });
  const instance = instantiated instanceof WebAssembly.Instance ? instantiated : instantiated.instance;
  memory = instance.exports.memory;
  return createWasmTufVerifier(instance);
}

// The only public result is a target whose metadata chain and content hash were
// accepted by sigstore-tuf. The cache is committed after verification, never before.
export function createSigstoreTufTrustRootProvider({
  metadataStore,
  verifyTuf,
  fetchInputs = fetchSigstoreTufInputs,
  now = () => Math.floor(Date.now() / 1000),
  onFailure = async () => {},
} = {}) {
  if (!metadataStore || typeof metadataStore.load !== "function" ||
      typeof metadataStore.commit !== "function" || typeof verifyTuf !== "function" ||
      typeof fetchInputs !== "function" || typeof onFailure !== "function" || typeof now !== "function") {
    throw new TypeError("SIGSTORE_TUF_PROVIDER_DEPENDENCIES_REQUIRED");
  }

  async function loadTrustedRoot({ candidateId = null } = {}) {
    let stage = "cache_read";
    try {
      const previous = await metadataStore.load();
      if (!previous || !Number.isSafeInteger(previous.revision) ||
          !Number.isSafeInteger(previous.rootVersion) || !previous.cache ||
          typeof previous.cache !== "object" || Array.isArray(previous.cache)) {
        throw new Error("TUF_CACHE_SNAPSHOT_INVALID");
      }

      const cachedRootRotations = previous.rootVersion - SIGSTORE_TUF_BOOTSTRAP_ROOT_VERSION;
      const cacheHasCompleteRootChain = cachedRootRotations >= 0 && cachedRootRotations <= 128 &&
        Array.from({ length: cachedRootRotations }, (_, index) =>
          SIGSTORE_TUF_BOOTSTRAP_ROOT_VERSION + index + 1
        ).every(version => Object.hasOwn(previous.cache, "root_history/" + version + ".root.json"));
      const rootVersionHint = cacheHasCompleteRootChain
        ? previous.rootVersion : SIGSTORE_TUF_BOOTSTRAP_ROOT_VERSION;

      stage = "metadata_fetch";
      let remote = await fetchInputs({ cache: previous.cache, rootVersion: rootVersionHint });
      if (!remote || !remote.metadata || !remote.targets || remote.targetPath !== "trusted_root.json") {
        throw new Error("TUF_REMOTE_INPUT_INVALID");
      }

      stage = "tuf_verify";
      const verificationInput = {
        cache: previous.cache,
        metadata: remote.metadata,
        targets: remote.targets,
        target_path: remote.targetPath,
        now_unix_seconds: now(),
      };
      let verified = await verifyTuf(verificationInput);

      // Migration/recovery path: an older cache may have been created from a
      // later bootstrap, or its sequential root history may be damaged. Retry
      // once from the pinned bootstrap root with the complete root chain. The
      // Rust updater still authenticates every cached root before adopting it.
      if ((!verified || verified.ok !== true) && rootVersionHint > SIGSTORE_TUF_BOOTSTRAP_ROOT_VERSION) {
        stage = "metadata_fetch";
        remote = await fetchInputs({
          cache: previous.cache,
          rootVersion: SIGSTORE_TUF_BOOTSTRAP_ROOT_VERSION,
        });
        if (!remote || !remote.metadata || !remote.targets || remote.targetPath !== "trusted_root.json") {
          throw new Error("TUF_REMOTE_INPUT_INVALID");
        }
        stage = "tuf_verify";
        verified = await verifyTuf({
          ...verificationInput,
          metadata: remote.metadata,
          targets: remote.targets,
        });
      }
      if (!verified || verified.ok !== true || verified.code !== "TUF_CHAIN_VERIFIED" ||
          !Number.isSafeInteger(verified.root_version) || verified.root_version < previous.rootVersion ||
          !Number.isSafeInteger(verified.timestamp_version) ||
          !Number.isSafeInteger(verified.snapshot_version) ||
          !Number.isSafeInteger(verified.targets_version) ||
          !verified.cache || typeof verified.cache !== "object" ||
          !Object.hasOwn(verified.cache, "root.json") ||
          typeof verified.verified_target_base64 !== "string") {
        throw new Error(verified?.code || "TUF_CHAIN_VERIFICATION_FAILED");
      }
      const trustedRootBytes = decodeBase64(verified.verified_target_base64);

      stage = "cache_commit";
      const committed = await metadataStore.commit({
        expectedRevision: previous.revision,
        rootVersion: verified.root_version,
        cache: verified.cache,
      });
      if (!committed || committed.revision !== previous.revision + 1 ||
          committed.rootVersion !== verified.root_version) {
        throw new Error("TUF_CACHE_COMMIT_UNCONFIRMED");
      }

      return Object.freeze({
        ok: true,
        target: trustedRootBytes,
        targetName: "trusted_root.json",
        rootVersion: verified.root_version,
        timestampVersion: verified.timestamp_version,
        snapshotVersion: verified.snapshot_version,
        targetsVersion: verified.targets_version,
        cacheRevision: committed.revision,
      });
    } catch (error) {
      const failure = {
        stage,
        code: typeof error?.message === "string" && /^[A-Z0-9_]{1,80}$/.test(error.message)
          ? error.message : "SIGSTORE_TUF_UNAVAILABLE",
      };
      try { await onFailure({ candidateId, ...failure }); } catch {}
      const wrapped = new Error(failure.code);
      wrapped.code = failure.code;
      wrapped.stage = stage;
      throw wrapped;
    }
  }

  return Object.freeze({ loadTrustedRoot });
}
