// Supply Chain Shield: validate third-party skill/agent metadata before catalog admission.
// Candidate content is never executed and candidate metadata never grants capabilities.
const ID = /^[a-z][a-z0-9_]{0,47}$/;
const VERSION = /^(0|[1-9]\d*)\\.(0|[1-9]\d*)\\.(0|[1-9]\d*)$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = code => Object.freeze({ ok: false, code });
const stringList = value => Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0) &&
  new Set(value).size === value.length;
const validPath = value => typeof value === "string" && value.length <= 512 &&
  !/[\\%?#:\x00-\x1f\x7f]/.test(value) && !value.startsWith("/") && !value.endsWith("/") &&
  !value.includes("//") && value.split("/").every(part => part !== "." && part !== ".." && /^[A-Za-z0-9_.-]+$/.test(part));
const validRepository = value => typeof value === "string" && value.length <= 200 &&
  value.split("/").length === 2 && value.split("/").every(part => part !== "." && part !== ".." && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part));

export function assessSkillIntake(candidate, { approvedLicenses = [...LICENSES], approvedRepositories = [] } = {}) {
  if (!plain(candidate)) return fail("INVALID_SKILL_CANDIDATE");
  if (!Array.isArray(approvedLicenses) || !approvedLicenses.every(x => typeof x === "string") ||
      !Array.isArray(approvedRepositories) || !approvedRepositories.every(x => typeof x === "string")) return fail("INVALID_INTAKE_POLICY");
  if (typeof candidate.id !== "string" || !ID.test(candidate.id)) return fail("INVALID_SKILL_ID");
  if (typeof candidate.version !== "string" || !VERSION.test(candidate.version)) return fail("INVALID_SKILL_VERSION");
  if (typeof candidate.description !== "string" || !candidate.description.trim() || candidate.description.length > 240) return fail("INVALID_SKILL_DESCRIPTION");
  if (candidate.allowedToolIds !== undefined && (!Array.isArray(candidate.allowedToolIds) ||
      candidate.allowedToolIds.length > 0)) return fail("SKILL_CANNOT_GRANT_CAPABILITIES");
  if (typeof candidate.content !== "string" || !candidate.content.trim() || candidate.content.includes("\0") ||
      new TextEncoder().encode(candidate.content).byteLength > 24 * 1024) return fail("INVALID_SKILL_CONTENT");
  const source = candidate.source;
  if (!plain(source) || !validRepository(source.repository) || !validPath(source.path) ||
      typeof source.commit !== "string" || !SHA1.test(source.commit) ||
      typeof source.blobSha !== "string" || !SHA1.test(source.blobSha)) return fail("INVALID_SKILL_PROVENANCE");
  if (typeof source.license !== "string" || !approvedLicenses.includes(source.license)) return fail("LICENSE_NOT_APPROVED");
  if (approvedRepositories.length && !approvedRepositories.includes(source.repository)) return fail("REPOSITORY_NOT_APPROVED");
  return Object.freeze({ ok: true, status: "REVIEW_REQUIRED", id: candidate.id, version: candidate.version,
    source: Object.freeze({ repository: source.repository, path: source.path, license: source.license,
      commit: source.commit, blobSha: source.blobSha }), capabilities: Object.freeze([]),
    contentTrust: "untrusted_reference", executable: false });
}

// Explicit pre-publication integrity gate. The caller must supply the expected SHA-256
// from a trusted acquisition step; a candidate-provided hash alone is not provenance.
export async function verifySkillIntake(candidate, options = {}) {
  const assessment = assessSkillIntake(candidate, options);
  if (!assessment.ok) return assessment;
  if (typeof candidate.contentSha256 !== "string" || !SHA256.test(candidate.contentSha256)) return fail("INVALID_CONTENT_SHA256");
  if (!globalThis.crypto?.subtle) return fail("CRYPTO_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(candidate.content));
  const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== candidate.contentSha256) return fail("CONTENT_HASH_MISMATCH");
  return Object.freeze({ ...assessment, contentTrust: "sha256_verified", contentSha256: actual });
}

export function assessAgentIntake(candidate, { approvedSkillIds = [], approvedToolIds = [] } = {}) {
  if (!plain(candidate)) return fail("INVALID_AGENT_CANDIDATE");
  if (!stringList(approvedSkillIds) || !stringList(approvedToolIds)) return fail("INVALID_AGENT_INTAKE_POLICY");
  if (typeof candidate.id !== "string" || !ID.test(candidate.id)) return fail("INVALID_AGENT_ID");
  if (typeof candidate.version !== "string" || !VERSION.test(candidate.version)) return fail("INVALID_AGENT_VERSION");
  if (typeof candidate.role !== "string" || !candidate.role.trim() || candidate.role.length > 80) return fail("INVALID_AGENT_ROLE");
  if (!Array.isArray(candidate.skillIds) || !candidate.skillIds.length || candidate.skillIds.length > 12 ||
      !stringList(candidate.skillIds) || candidate.skillIds.some(id => !approvedSkillIds.includes(id))) return fail("AGENT_SKILL_NOT_APPROVED");
  if (candidate.allowedToolIds !== undefined &&
      (!stringList(candidate.allowedToolIds) || candidate.allowedToolIds.some(id => !approvedToolIds.includes(id)))) {
    return fail("AGENT_CAPABILITY_NOT_APPROVED");
  }
  // Candidate-declared capabilities are never propagated. Runtime permissions come from code-owned profiles.
  return Object.freeze({ ok: true, status: "REVIEW_REQUIRED", id: candidate.id, version: candidate.version,
    skillIds: Object.freeze([...candidate.skillIds]), capabilities: Object.freeze([]), executable: false });
}
