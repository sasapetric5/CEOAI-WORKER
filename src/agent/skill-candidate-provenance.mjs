// Strict metadata validation for externally supplied Skill candidates.
const SHA1 = /^[a-f0-9]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\\/[A-Za-z0-9_.-]{1,100}$/;
export function validatePinnedSkillCandidate(input = {}) {
  const { id, repository, commit, path, blobSha } = input;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error("CANDIDATE_ID_INVALID");
  if (typeof repository !== "string" || !REPOSITORY.test(repository) || repository.includes("..")) throw new Error("CANDIDATE_REPOSITORY_INVALID");
  if (typeof commit !== "string" || !SHA1.test(commit)) throw new Error("CANDIDATE_COMMIT_INVALID");
  if (typeof blobSha !== "string" || !SHA1.test(blobSha)) throw new Error("CANDIDATE_BLOB_SHA_INVALID");
  if (typeof path !== "string" || !path || path.length > 512 || path.includes("\\\\") || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === "..") || path.split("/").at(-1).toLowerCase() !== "skill.md") throw new Error("CANDIDATE_PATH_INVALID");
  return Object.freeze({ id, repository, commit: commit.toLowerCase(), path, blobSha: blobSha.toLowerCase() });
}
