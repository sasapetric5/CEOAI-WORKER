// Read-only GitHub source adapter. Only immutable owner-approved repository pins are queried.
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_TREE = 5000;
const MAX_BYTES = 24 * 1024;
const MAX_SKILL_FILES = 64;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_SKILL_BUNDLE_BYTES = 256 * 1024;
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
function validPath(path) {
  return typeof path === "string" && path.length <= 512 && !path.startsWith("/") &&
    !path.includes("\\") && !path.includes("%") &&
    path.split("/").every(part => part && part !== "." && part !== ".." && /^[A-Za-z0-9_.-]+$/.test(part));
}
function decode(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function readBoundedResponse(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("SKILL_BUNDLE_FILE_SIZE_LIMIT_EXCEEDED");
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error("SKILL_BUNDLE_FILE_SIZE_LIMIT_EXCEEDED");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("SKILL_BUNDLE_FILE_SIZE_LIMIT_EXCEEDED");
  return bytes;
}

export function createGitHubSkillSource({ repositories = [], fetchImpl = globalThis.fetch, maxCandidates = 100 } = {}) {
  if (!Array.isArray(repositories) || repositories.length < 1 || repositories.length > 20 ||
      typeof fetchImpl !== "function" || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 500) {
    throw new TypeError("INVALID_GITHUB_SKILL_SOURCE_CONFIG");
  }
  const pins = new Map();
  for (const pin of repositories) {
    if (!plain(pin) || !REPO.test(pin.repository) || !SHA.test(pin.commit) || pins.has(pin.repository)) {
      throw new TypeError("INVALID_APPROVED_REPOSITORY_PIN");
    }
    pins.set(pin.repository, pin.commit);
  }
  async function getJson(url) {
    const response = await fetchImpl(url, {
      method: "GET", redirect: "error",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!response || !response.ok) throw new Error("PINNED_GITHUB_SOURCE_UNAVAILABLE");
    const data = await response.json();
    if (!plain(data)) throw new Error("INVALID_GITHUB_SOURCE_RESPONSE");
    return data;
  }
  async function discover({ limit = maxCandidates } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxCandidates) throw new TypeError("INVALID_DISCOVERY_LIMIT");
    const candidates = [];
    for (const [repository, commit] of pins) {
      const tree = await getJson("https://api.github.com/repos/" + repository + "/git/trees/" + commit + "?recursive=1");
      if (tree.truncated === true || !Array.isArray(tree.tree) || tree.tree.length > MAX_TREE) throw new Error("GITHUB_TREE_TRUNCATED_OR_OVERSIZED");
      for (const entry of tree.tree) {
        if (entry.type !== "blob" || !validPath(entry.path) || !/(^|\/)SKILL\.md$/i.test(entry.path) || !SHA.test(entry.sha || "")) continue;
        const slug = (repository + "_" + entry.path).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
        candidates.push(Object.freeze({ id: "ext_" + slug + "_" + commit.slice(0, 8), repository, path: entry.path, commit, blobSha: entry.sha }));
        if (candidates.length >= limit) return candidates;
      }
    }
    return candidates;
  }
  async function fetchCandidate(candidate) {
    if (!plain(candidate) || pins.get(candidate.repository) !== candidate.commit ||
        !validPath(candidate.path) || !/(^|\/)SKILL\.md$/i.test(candidate.path) || !SHA.test(candidate.blobSha || "")) {
      return { ok: false, code: "CANDIDATE_NOT_FROM_APPROVED_PINNED_SOURCE" };
    }
    const [file, license, tree] = await Promise.all([
      getJson("https://api.github.com/repos/" + candidate.repository + "/contents/" +
        candidate.path.split("/").map(encodeURIComponent).join("/") + "?ref=" + candidate.commit),
      getJson("https://api.github.com/repos/" + candidate.repository + "/license?ref=" + candidate.commit),
      getJson("https://api.github.com/repos/" + candidate.repository + "/git/trees/" + candidate.commit + "?recursive=1")
    ]);
    if (file.type !== "file" || file.sha !== candidate.blobSha || file.encoding !== "base64" || typeof file.content !== "string") {
      return { ok: false, code: "PINNED_SKILL_BLOB_MISMATCH" };
    }
    let content;
    try { content = decode(file.content); } catch { return { ok: false, code: "SKILL_CONTENT_NOT_UTF8" }; }
    if (!content.trim() || content.includes("\0") || new TextEncoder().encode(content).byteLength > MAX_BYTES) {
      return { ok: false, code: "SKILL_CONTENT_INVALID_OR_OVERSIZED" };
    }
    if (tree.truncated === true || !Array.isArray(tree.tree) || tree.tree.length > MAX_TREE) {
      return { ok: false, code: "GITHUB_TREE_TRUNCATED_OR_OVERSIZED" };
    }
    const licenseId = license.license && license.license.spdx_id;
    if (typeof licenseId !== "string") return { ok: false, code: "LICENSE_NOT_DETECTED" };
    const prefix = candidate.path.replace(/\/SKILL\.md$/i, "");
    const bundleEntries = tree.tree.filter(entry => entry.type === "blob" && typeof entry.path === "string" &&
      (prefix ? entry.path.startsWith(prefix + "/") : true));
    if (bundleEntries.length > MAX_SKILL_FILES) return { ok: false, code: "SKILL_BUNDLE_FILE_LIMIT_EXCEEDED" };
    if (bundleEntries.some(entry => !validPath(entry.path) || !SHA.test(entry.sha || ""))) {
      return { ok: false, code: "SKILL_BUNDLE_PROVENANCE_INVALID" };
    }
    const entrypoint = bundleEntries.find(entry => entry.path === candidate.path);
    if (!entrypoint || entrypoint.sha !== candidate.blobSha) return { ok: false, code: "SKILL_BUNDLE_ENTRYPOINT_MISMATCH" };
    let bundleBytes = 0;
    const files = [];
    for (const entry of bundleEntries) {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) {
        return { ok: false, code: "SKILL_BUNDLE_FILE_SIZE_INVALID" };
      }
      bundleBytes += entry.size;
      if (bundleBytes > MAX_SKILL_BUNDLE_BYTES) return { ok: false, code: "SKILL_BUNDLE_SIZE_LIMIT_EXCEEDED" };
      if (entry.path === candidate.path) {
        files.push(Object.freeze({ path: entry.path, content, size: new TextEncoder().encode(content).byteLength, sha: entry.sha }));
        continue;
      }
      const rawUrl = "https://raw.githubusercontent.com/" + candidate.repository + "/" + candidate.commit + "/" +
        entry.path.split("/").map(encodeURIComponent).join("/");
      const response = await fetchImpl(rawUrl, { method: "GET", redirect: "error" });
      if (!response?.ok) return { ok: false, code: "SKILL_BUNDLE_FILE_FETCH_FAILED" };
      let fileContent;
      try { fileContent = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedResponse(response, MAX_FILE_BYTES)); }
      catch { return { ok: false, code: "SKILL_BUNDLE_FILE_NOT_UTF8" }; }
      if (new TextEncoder().encode(fileContent).byteLength !== entry.size || fileContent.includes("\0")) {
        return { ok: false, code: "SKILL_BUNDLE_FILE_SIZE_OR_CONTENT_MISMATCH" };
      }
      files.push(Object.freeze({ path: entry.path, content: fileContent, size: entry.size, sha: entry.sha }));
    }
    if (!files.some(file => file.path === candidate.path)) return { ok: false, code: "SKILL_BUNDLE_MISSING_ENTRYPOINT" };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    const contentSha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const bundleManifest = files.map(file => file.path + "\\0" + file.sha + "\\0" + file.size).sort().join("\\n");
    const bundleDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundleManifest));
    const bundleSha256 = [...new Uint8Array(bundleDigest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return { ok: true, candidate, content, license: licenseId, files, contentSha256, bundleSha256 };
  }
  return Object.freeze({ discover, fetchCandidate, approvedRepositories: Object.freeze([...pins.keys()]) });
}
