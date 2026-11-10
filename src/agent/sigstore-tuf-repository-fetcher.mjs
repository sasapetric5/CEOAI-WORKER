// Bounded acquisition of Sigstore Public Good TUF repository inputs.
// All fetched bytes remain untrusted until the Rust TUF verifier validates the complete chain.
const REPOSITORY = "https://tuf-repo-cdn.sigstore.dev";
const ROOT_BOOTSTRAP_VERSION = 16; // Must match security/tuf-worker/bootstrap-root.json.
const MAX_ROOT_ROTATIONS = 32;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_ROOT_BYTES = 512 * 1024;
const MAX_TIMESTAMP_BYTES = 32 * 1024;
const MAX_TARGET_BYTES = 2 * 1024 * 1024;
const TARGET_NAME = "trusted_root.json";
const SHA256 = /^[a-f0-9]{64}$/;

function asBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  }
  return btoa(binary);
}

function parseMetadata(bytes, label) {
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("TUF_REMOTE_METADATA_INVALID_" + label); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !value.signed || typeof value.signed !== "object" || Array.isArray(value.signed)) {
    throw new Error("TUF_REMOTE_METADATA_INVALID_" + label);
  }
  return value;
}

function metadataVersion(document, role) {
  const entry = document.signed.meta?.[role + ".json"];
  if (!entry || !Number.isSafeInteger(entry.version) || entry.version < 1) {
    throw new Error("TUF_REMOTE_METADATA_REFERENCE_INVALID_" + role.toUpperCase());
  }
  return entry.version;
}

async function readBounded(response, maxBytes, label) {
  if (response.status < 200 || response.status >= 300) {
    const error = new Error("TUF_REMOTE_FETCH_FAILED_" + label);
    error.status = response.status;
    throw error;
  }
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > maxBytes) throw new Error("TUF_REMOTE_RESPONSE_TOO_LARGE_" + label);
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("TUF_REMOTE_RESPONSE_TOO_LARGE_" + label);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error("TUF_REMOTE_RESPONSE_TOO_LARGE_" + label);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function fetchSigstoreTufInputs({
  cache = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 7000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("TUF_FETCH_ADAPTER_REQUIRED");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000) {
    throw new TypeError("INVALID_TUF_FETCH_TIMEOUT");
  }

  const metadataBytes = Object.create(null);
  const targetsBytes = Object.create(null);
  let requests = 0;

  async function get(path, maxBytes, label, allowNotFound = false) {
    if (typeof path !== "string" || path.startsWith("/") || path.includes("..") ||
        !/^[A-Za-z0-9._/-]+$/.test(path)) throw new Error("INVALID_TUF_REMOTE_PATH");
    if (++requests > MAX_ROOT_ROTATIONS + 8) throw new Error("TUF_REMOTE_REQUEST_LIMIT");
    const url = REPOSITORY + "/" + path;
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/octet-stream, application/json" },
    });
    if (response.url && response.url !== url) throw new Error("TUF_REMOTE_REDIRECT_REJECTED");
    if (allowNotFound && response.status === 404) return null;
    return readBounded(response, maxBytes, label);
  }

  // The embedded bootstrap root is version 16. Fetch only sequentially named successors;
  // the TUF engine decides whether each candidate root is trusted. No unversioned root.json
  // is accepted as a replacement for the pinned bootstrap root.
  for (let version = ROOT_BOOTSTRAP_VERSION + 1;
       version <= ROOT_BOOTSTRAP_VERSION + MAX_ROOT_ROTATIONS; version++) {
    const bytes = await get(version + ".root.json", MAX_ROOT_BYTES, "ROOT_" + version, true);
    if (bytes === null) break;
    metadataBytes[version + ".root.json"] = bytes;
    if (version === ROOT_BOOTSTRAP_VERSION + MAX_ROOT_ROTATIONS) {
      throw new Error("TUF_ROOT_ROTATION_LIMIT_REACHED");
    }
  }

  const timestamp = await get("timestamp.json", MAX_TIMESTAMP_BYTES, "TIMESTAMP");
  metadataBytes["timestamp.json"] = timestamp;
  const timestampDoc = parseMetadata(timestamp, "TIMESTAMP");
  const snapshotVersion = metadataVersion(timestampDoc, "snapshot");
  const snapshotName = snapshotVersion + ".snapshot.json";

  const snapshot = await get(snapshotName, MAX_METADATA_BYTES, "SNAPSHOT");
  metadataBytes[snapshotName] = snapshot;
  const snapshotDoc = parseMetadata(snapshot, "SNAPSHOT");
  const targetsVersion = metadataVersion(snapshotDoc, "targets");
  const targetsName = targetsVersion + ".targets.json";

  const targets = await get(targetsName, MAX_METADATA_BYTES, "TARGETS");
  metadataBytes[targetsName] = targets;
  const targetsDoc = parseMetadata(targets, "TARGETS");
  const target = targetsDoc.signed.targets?.[TARGET_NAME];
  const targetHash = target?.hashes?.sha256;
  if (!target || !Number.isSafeInteger(target.length) || target.length < 1 ||
      target.length > MAX_TARGET_BYTES || !SHA256.test(targetHash || "")) {
    throw new Error("TUF_TRUSTED_ROOT_TARGET_REFERENCE_INVALID");
  }

  const targetPath = "targets/" + targetHash + "." + TARGET_NAME;
  const targetBytes = await get(targetPath, MAX_TARGET_BYTES, "TRUSTED_ROOT_TARGET");
  if (targetBytes.byteLength !== target.length) throw new Error("TUF_TRUSTED_ROOT_TARGET_LENGTH_MISMATCH");
  targetsBytes[targetHash + "." + TARGET_NAME] = targetBytes;

  const encodeMap = map => Object.fromEntries(Object.entries(map).map(([name, bytes]) => [name, asBase64(bytes)]));
  return Object.freeze({
    metadata: Object.freeze(encodeMap(metadataBytes)),
    targets: Object.freeze(encodeMap(targetsBytes)),
    cache: cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {},
    targetPath: TARGET_NAME,
    fetchedCount: requests,
  });
}
