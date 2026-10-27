// CEOAI V5.0: static skill metadata. Skills do not execute code.
const ID = /^[a-z][a-z0-9_]{0,47}$/;
export function createSkillRegistry({ skills = [], toolRegistry } = {}) {
  if (!toolRegistry || typeof toolRegistry.get !== "function") throw new TypeError("TOOL_REGISTRY_REQUIRED");
  const entries = new Map();
  for (const s of skills) {
    if (!s || typeof s !== "object" || Array.isArray(s) || typeof s.id !== "string" || !ID.test(s.id)) throw new TypeError("INVALID_SKILL_ID");
    if (entries.has(s.id)) throw new TypeError("DUPLICATE_SKILL:" + s.id);
    if (typeof s.version !== "string" || !/^\d+\.\d+\.\d+$/.test(s.version)) throw new TypeError("INVALID_SKILL_VERSION:" + s.id);
    if (typeof s.description !== "string" || !s.description.trim() || s.description.length > 240) throw new TypeError("INVALID_SKILL_DESCRIPTION:" + s.id);
    if (!Array.isArray(s.allowedToolIds) || s.allowedToolIds.some((id) => typeof id !== "string" || !toolRegistry.get(id))) throw new TypeError("UNKNOWN_SKILL_TOOL:" + s.id);
    if (new Set(s.allowedToolIds).size !== s.allowedToolIds.length) throw new TypeError("DUPLICATE_SKILL_TOOL:" + s.id);
    entries.set(s.id, Object.freeze({ id: s.id, version: s.version, description: s.description.trim(), allowedToolIds: Object.freeze([...s.allowedToolIds]) }));
  }
  return Object.freeze({
    list() { return [...entries.values()].map((s) => ({ ...s, allowedToolIds: [...s.allowedToolIds] })); },
    get(id) { const s = entries.get(id); return s ? { ...s, allowedToolIds: [...s.allowedToolIds] } : null; },
    allows(skillId, toolId) { const s = entries.get(skillId); return Boolean(s && s.allowedToolIds.includes(toolId) && toolRegistry.get(toolId)); },
  });
}
