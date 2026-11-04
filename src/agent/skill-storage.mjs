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

export async function publishSkillCatalogToKV({ kv, skills, toolRegistry, indexKey = SKILL_INDEX_KEY, documentPrefix = SKILL_DOCUMENT_PREFIX } = {}) {
  if (!kv || typeof kv.put !== "function") throw new TypeError("SKILL_KV_REQUIRED");
  if (!Array.isArray(skills) || skills.length > MAX_SKILLS) throw new TypeError("INVALID_SKILL_COLLECTION");
  if (typeof indexKey !== "string" || !indexKey.trim() || indexKey.length > 512 || typeof documentPrefix !== "string" || !documentPrefix.trim() || documentPrefix.length > 512) throw new TypeError("INVALID_SKILL_STORAGE_KEYS");

  // Reuse registry validation before any KV write. All skill documents must be supplied at intake.
  const registry = createSkillRegistry({ skills, toolRegistry });
  const metadata = [];
  for (const skill of registry.list()) {
    const loaded = registry.load(skill.id);
    if (!loaded || typeof loaded.content !== "string") throw new TypeError("SKILL_CONTENT_REQUIRED:" + skill.id);
    const contentSha256 = await sha256(loaded.content);
    const key = documentKey(skill.id, skill.version, contentSha256, documentPrefix);
    await kv.put(key, loaded.content);
    metadata.push({ ...skill, contentSha256 });
  }
  const serialized = JSON.stringify({ schemaVersion: 1, skills: metadata });
  if (new TextEncoder().encode(serialized).byteLength > MAX_INDEX_BYTES) throw new TypeError("SKILL_INDEX_TOO_LARGE");
  // The index is the commit point: readers never see a partially published catalog pointer.
  await kv.put(indexKey, serialized);
  return { ok: true, skillCount: metadata.length, indexKey, indexBytes: new TextEncoder().encode(serialized).byteLength };
}

export async function createKVSkillRegistry({ kv, toolRegistry, capabilityPolicy = {}, indexKey = SKILL_INDEX_KEY, documentPrefix = SKILL_DOCUMENT_PREFIX } = {}) {
  if (!kv || typeof kv.get !== "function") throw new TypeError("SKILL_KV_REQUIRED");
  const raw = await kv.get(indexKey);
  if (typeof raw !== "string" || !raw.length || new TextEncoder().encode(raw).byteLength > MAX_INDEX_BYTES) throw new Error("SKILL_INDEX_UNAVAILABLE");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("SKILL_INDEX_INVALID_JSON"); }
  if (!plain(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.skills) || parsed.skills.length > MAX_SKILLS) throw new Error("SKILL_INDEX_INVALID_SCHEMA");
  if (!plain(capabilityPolicy)) throw new TypeError("INVALID_SKILL_CAPABILITY_POLICY");
  const knownIds = new Set();
  for (const entry of parsed.skills) {
    if (!plain(entry) || typeof entry.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.contentSha256)) throw new Error("SKILL_INDEX_INVALID_ENTRY");
    if (typeof entry.id !== "string" || knownIds.has(entry.id)) throw new Error("SKILL_INDEX_INVALID_ENTRY");
    knownIds.add(entry.id);
  }
  if (Object.keys(capabilityPolicy).some((id) => !knownIds.has(id))) throw new TypeError("UNKNOWN_SKILL_CAPABILITY_POLICY_ID");
  const trustedSkills = parsed.skills.map((entry) => {
    const approvedToolIds = capabilityPolicy[entry.id] ?? [];
    if (!Array.isArray(approvedToolIds) || approvedToolIds.length > 8 || approvedToolIds.some((id) => typeof id !== "string")) throw new TypeError("INVALID_SKILL_CAPABILITY_POLICY:" + entry.id);
    // Skill catalog metadata never grants capabilities. Only this code-owned policy may do so.
    return { ...entry, allowedToolIds: [...approvedToolIds] };
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
