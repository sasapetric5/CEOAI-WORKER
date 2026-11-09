// KV-backed catalog: one bounded metadata index + immutable, hash-addressed skill documents.
// Publish document objects first and switch the index pointer last. Old versions remain readable.
import { createSkillRegistry } from "./skill-registry.mjs";

export const SKILL_INDEX_KEY = "skills:v1:index";
export const SKILL_DOCUMENT_PREFIX = "skills:v1:doc:";
const MAX_SKILLS = 10000;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

async function sha256(text) {
  if (!globalThis.crypto?.subtle) throw new Error("WEB_CRYPTO_UNAVAILABLE");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function documentKey(id, version, hash, prefix = SKILL_DOCUMENT_PREFIX) {
  return `${prefix}${id}:${version}:${hash}`;
}
function idSet(values, knownIds, errorCode) {
  if (!Array.isArray(values) || values.length > MAX_SKILLS || values.some((id) => typeof id !== "string" || !knownIds.has(id)) || new Set(values).size !== values.length) {
    throw new TypeError(errorCode);
  }
  return new Set(values);
}
function intersect(left, right) {
  const allowed = new Set(right);
  return left.filter((id) => allowed.has(id));
}

export async function publishSkillCatalogToKV({ kv, skills, toolRegistry, approvedSkillIds = [], indexKey = SKILL_INDEX_KEY, documentPrefix = SKILL_DOCUMENT_PREFIX } = {}) {
  if (!kv || typeof kv.put !== "function") throw new TypeError("SKILL_KV_REQUIRED");
  if (!Array.isArray(skills) || skills.length > MAX_SKILLS) throw new TypeError("INVALID_SKILL_COLLECTION");
  if (typeof indexKey !== "string" || !indexKey.trim() || indexKey.length > 512 || typeof documentPrefix !== "string" || !documentPrefix.trim() || documentPrefix.length > 512) throw new TypeError("INVALID_SKILL_STORAGE_KEYS");

  // Reuse registry validation before any KV write. Approval is a separate trusted input;
  // skill documents and their metadata cannot approve themselves.
  const registry = createSkillRegistry({ skills, toolRegistry });
  const knownIds = new Set(registry.list().map((skill) => skill.id));
  const approved = idSet(approvedSkillIds, knownIds, "INVALID_APPROVED_SKILL_IDS");
  const metadata = [];
  for (const skill of registry.list()) {
    const loaded = await registry.load(skill.id);
    if (!loaded || typeof loaded.content !== "string") throw new TypeError("SKILL_CONTENT_REQUIRED:" + skill.id);
    const contentSha256 = await sha256(loaded.content);
    const key = documentKey(skill.id, skill.version, contentSha256, documentPrefix);
    await kv.put(key, loaded.content);
    metadata.push({ ...skill, contentSha256, approvalStatus: approved.has(skill.id) ? "approved" : "quarantined" });
  }
  const serialized = JSON.stringify({ schemaVersion: 1, skills: metadata });
  if (new TextEncoder().encode(serialized).byteLength > MAX_INDEX_BYTES) throw new TypeError("SKILL_INDEX_TOO_LARGE");
  // The index is the commit point: readers never see a partially published catalog pointer.
  await kv.put(indexKey, serialized);
  return { ok: true, skillCount: metadata.length, approvedCount: approved.size, quarantinedCount: metadata.length - approved.size, indexKey, indexBytes: new TextEncoder().encode(serialized).byteLength };
}

export async function createKVSkillRegistry({
  kv, toolRegistry, capabilityPolicy = {}, approvedSkillIds = [], skillLifecycle = null,
  categoryBySkillId = {}, categoryCapabilityPolicy = {},
  indexKey = SKILL_INDEX_KEY, documentPrefix = SKILL_DOCUMENT_PREFIX
} = {}) {
  if (!kv || typeof kv.get !== "function") throw new TypeError("SKILL_KV_REQUIRED");
  const raw = await kv.get(indexKey);
  if (typeof raw !== "string" || !raw.length || new TextEncoder().encode(raw).byteLength > MAX_INDEX_BYTES) throw new Error("SKILL_INDEX_UNAVAILABLE");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("SKILL_INDEX_INVALID_JSON"); }
  if (!plain(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.skills) || parsed.skills.length > MAX_SKILLS) throw new Error("SKILL_INDEX_INVALID_SCHEMA");
  if (!plain(capabilityPolicy) || !plain(categoryBySkillId) || !plain(categoryCapabilityPolicy)) throw new TypeError("INVALID_SKILL_CAPABILITY_POLICY");

  const knownIds = new Set();
  for (const entry of parsed.skills) {
    if (!plain(entry) || typeof entry.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.contentSha256)) throw new Error("SKILL_INDEX_INVALID_ENTRY");
    if (typeof entry.id !== "string" || knownIds.has(entry.id)) throw new Error("SKILL_INDEX_INVALID_ENTRY");
    if (entry.approvalStatus !== undefined && !["approved", "quarantined"].includes(entry.approvalStatus)) throw new Error("SKILL_INDEX_INVALID_APPROVAL_STATUS");
    knownIds.add(entry.id);
  }
  const approved = idSet(approvedSkillIds, knownIds, "INVALID_APPROVED_SKILL_IDS");
  if (skillLifecycle !== null && (typeof skillLifecycle.get !== "function" || typeof skillLifecycle.isSelectable !== "function")) throw new TypeError("INVALID_SKILL_LIFECYCLE");
  // Lifecycle approval is read from the trusted durable lifecycle store, never from
  // mutable KV catalog metadata. Failure to read it fails closed.
  const lifecycleApproved = new Set();
  if (skillLifecycle) {
    for (const id of knownIds) {
      let record;
      try { record = await skillLifecycle.get(id); }
      catch { throw new Error("SKILL_LIFECYCLE_UNAVAILABLE"); }
      if (skillLifecycle.isSelectable(record) === true) lifecycleApproved.add(id);
    }
  }
  const admitted = new Set([...approved, ...lifecycleApproved]);
  if (Object.keys(capabilityPolicy).some((id) => !knownIds.has(id)) || Object.keys(categoryBySkillId).some((id) => !knownIds.has(id))) throw new TypeError("UNKNOWN_SKILL_CAPABILITY_POLICY_ID");

  const categoryIds = new Set(Object.keys(categoryCapabilityPolicy));
  for (const [category, ids] of Object.entries(categoryCapabilityPolicy)) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(category) || !Array.isArray(ids) || ids.length > 8 || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) {
      throw new TypeError("INVALID_CATEGORY_CAPABILITY_POLICY:" + category);
    }
  }
  for (const [id, category] of Object.entries(categoryBySkillId)) {
    if (typeof category !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(category)) throw new TypeError("INVALID_SKILL_CATEGORY:" + id);
  }

  // Only the code-owned approvedSkillIds list controls runtime admission. The KV
  // approvalStatus is audit metadata and cannot be forged to bypass this gate.
  const trustedSkills = parsed.skills.filter((entry) => admitted.has(entry.id)).map((entry) => {
    const skillTools = capabilityPolicy[entry.id] ?? [];
    if (!Array.isArray(skillTools) || skillTools.length > 8 || skillTools.some((id) => typeof id !== "string") || new Set(skillTools).size !== skillTools.length) throw new TypeError("INVALID_SKILL_CAPABILITY_POLICY:" + entry.id);
    const category = categoryBySkillId[entry.id];
    const categoryTools = category && categoryIds.has(category) ? categoryCapabilityPolicy[category] : [];
    // Effective permissions are the intersection of skill-level and category-level
    // code-owned policies. Missing/unknown categories therefore grant no tools.
    return { ...entry, allowedToolIds: intersect(skillTools, categoryTools) };
  });
  return createSkillRegistry({
    skills: trustedSkills,
    toolRegistry,
    loadContent: async (skill) => {
      const key = documentKey(skill.id, skill.version, skill.contentSha256, documentPrefix);
      const content = await kv.get(key);
      if (typeof content !== "string") return null;
      const actualHash = await sha256(content);
      if (actualHash !== skill.contentSha256) throw new Error("SKILL_CONTENT_HASH_MISMATCH");
      return content;
    },
  });
}
