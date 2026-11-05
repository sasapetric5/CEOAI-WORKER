// Supply Chain Shield: validate third-party skill/agent metadata before any catalog admission.
// This module never executes candidate content and never grants capabilities.
const ID = /^[a-z][a-z0-9_]{0,47}$/;
const VERSION = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/;
const SHA = /^[a-f0-9]{40}$/;
const LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = code => Object.freeze({ ok: false, code });

export function assessSkillIntake(candidate, { approvedLicenses = [...LICENSES], approvedRepositories = [] } = {}) {
  if (!plain(candidate)) return fail("INVALID_SKILL_CANDIDATE");
  if (typeof candidate.id !== "string" || !ID.test(candidate.id)) return fail("INVALID_SKILL_ID");
  if (typeof candidate.version !== "string" || !VERSION.test(candidate.version)) return fail("INVALID_SKILL_VERSION");
  if (typeof candidate.description !== "string" || !candidate.description.trim() || candidate.description.length > 240) return fail("INVALID_SKILL_DESCRIPTION");
  if (Array.isArray(candidate.allowedToolIds) && candidate.allowedToolIds.length) return fail("SKILL_CANNOT_GRANT_CAPABILITIES");
  if (candidate.allowedToolIds !== undefined && !Array.isArray(candidate.allowedToolIds)) return fail("INVALID_SKILL_CAPABILITIES");
  if (typeof candidate.content !== "string" || !candidate.content.trim() || candidate.content.includes("\\0") ||
      new TextEncoder().encode(candidate.content).byteLength > 24 * 1024) return fail("INVALID_SKILL_CONTENT");
  const source = candidate.source;
  if (!plain(source) || typeof source.repository !== "string" || !/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(source.repository) ||
      typeof source.path !== "string" || !source.path || source.path.startsWith("/") || source.path.split("/").includes("..") ||
      typeof source.commit !== "string" || !SHA.test(source.commit) ||
      typeof source.blobSha !== "string" || !SHA.test(source.blobSha)) return fail("INVALID_SKILL_PROVENANCE");
  if (!approvedLicenses.includes(source.license)) return fail("LICENSE_NOT_APPROVED");
  if (approvedRepositories.length && !approvedRepositories.includes(source.repository)) return fail("REPOSITORY_NOT_APPROVED");
  return Object.freeze({ ok: true, status: "REVIEW_REQUIRED", id: candidate.id, version: candidate.version,
    source: Object.freeze({ repository: source.repository, path: source.path, license: source.license,
      commit: source.commit, blobSha: source.blobSha }), capabilities: Object.freeze([]),
    contentTrust: "untrusted_reference", executable: false });
}

export function assessAgentIntake(candidate, { approvedSkillIds = [], approvedToolIds = [] } = {}) {
  if (!plain(candidate)) return fail("INVALID_AGENT_CANDIDATE");
  if (typeof candidate.id !== "string" || !ID.test(candidate.id)) return fail("INVALID_AGENT_ID");
  if (typeof candidate.version !== "string" || !VERSION.test(candidate.version)) return fail("INVALID_AGENT_VERSION");
  if (typeof candidate.role !== "string" || !candidate.role.trim() || candidate.role.length > 80) return fail("INVALID_AGENT_ROLE");
  if (!Array.isArray(candidate.skillIds) || !candidate.skillIds.length || candidate.skillIds.length > 12 ||
      candidate.skillIds.some(id => typeof id !== "string" || !approvedSkillIds.includes(id)) ||
      new Set(candidate.skillIds).size !== candidate.skillIds.length) return fail("AGENT_SKILL_NOT_APPROVED");
  if (Array.isArray(candidate.allowedToolIds) && candidate.allowedToolIds.some(id => !approvedToolIds.includes(id))) return fail("AGENT_CAPABILITY_NOT_APPROVED");
  if (candidate.allowedToolIds !== undefined && !Array.isArray(candidate.allowedToolIds)) return fail("INVALID_AGENT_CAPABILITIES");
  // Candidate-declared capabilities are never propagated. Runtime permissions come from code-owned profiles.
  return Object.freeze({ ok: true, status: "REVIEW_REQUIRED", id: candidate.id, version: candidate.version,
    skillIds: Object.freeze([...candidate.skillIds]), capabilities: Object.freeze([]), executable: false });
}
