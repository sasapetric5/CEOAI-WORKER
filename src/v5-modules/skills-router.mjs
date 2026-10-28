// Deterministic skill candidate routing. This module selects metadata only;
// it does not execute skill instructions, grant tools, or enable disabled skills.
import skillRegistry from "../../skills/registry.json" with { type: "json" };

const DEFAULT_MAX_SKILLS = 4;
const TOKEN_RE = /[a-z0-9]+/g;

function tokens(value) {
  const normalized = String(value ?? "")
    .toLocaleLowerCase("sr-Latn")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return new Set(normalized.match(TOKEN_RE) ?? []);
}

export function selectSkillCandidates(registry, request, options = {}) {
  if (!registry || !Array.isArray(registry.skills) || !Array.isArray(registry.categories)) {
    throw new TypeError("Invalid skill registry");
  }
  const maxSkills = options.maxSkills ?? registry.routing_policy?.default_max_skills_per_task ?? DEFAULT_MAX_SKILLS;
  if (!Number.isInteger(maxSkills) || maxSkills < 1 || maxSkills > 8) {
    throw new RangeError("maxSkills must be an integer between 1 and 8");
  }
  const requestTokens = tokens(request);
  if (requestTokens.size === 0) return [];
  const categoryById = new Map(registry.categories.map((category) => [category.id, category]));
  const ranked = [];
  for (const skill of registry.skills) {
    if (!skill || typeof skill.id !== "string" || typeof skill.path !== "string") continue;
    const category = categoryById.get(skill.category);
    const searchable = tokens([
      skill.id, skill.name, skill.description, skill.category,
      ...(skill.tags ?? []), ...(skill.intents ?? []), ...(category?.tags ?? []),
      category?.label ?? ""
    ].join(" "));
    let score = 0;
    for (const token of requestTokens) if (searchable.has(token)) score += 1;
    if (score === 0) continue;
    ranked.push({
      id: skill.id, name: skill.name, path: skill.path, category: skill.category, score,
      runtime_status: skill.runtime_status ?? "not-enabled",
      eligible_for_execution:
        skill.runtime_status === "enabled" &&
        skill.license_status === "approved" &&
        skill.security_status === "verified" &&
        skill.external_actions === false
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked.slice(0, maxSkills);
}

export async function loadSkillRegistry() {
  if (skillRegistry.library_id !== "ceoai-shared-skills") {
    throw new Error("Unexpected skill registry");
  }
  return skillRegistry;
}
