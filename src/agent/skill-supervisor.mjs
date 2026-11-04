// Deterministic skill selection and bounded loading. It does not call an LLM or execute tools.
export function createSkillSupervisor({ skillRegistry, agentLoop = null, maxSelectedSkills = 3 } = {}) {
  if (!skillRegistry || typeof skillRegistry.search !== "function" || typeof skillRegistry.load !== "function") throw new TypeError("SKILL_REGISTRY_REQUIRED");
  if (agentLoop !== null && typeof agentLoop.run !== "function") throw new TypeError("INVALID_AGENT_LOOP");
  if (!Number.isSafeInteger(maxSelectedSkills) || maxSelectedSkills < 1 || maxSelectedSkills > 5) throw new TypeError("INVALID_SKILL_SELECTION_LIMIT");

  async function prepare({ task, skillIds, limit = maxSelectedSkills, requiredTags = [] } = {}) {
    if (typeof task !== "string" || !task.trim() || task.length > 4000) return { ok: false, code: "INVALID_SKILL_TASK", skills: [] };
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxSelectedSkills) return { ok: false, code: "INVALID_SKILL_SELECTION_LIMIT", skills: [] };
    let selected;
    if (skillIds !== undefined) {
      if (!Array.isArray(skillIds) || skillIds.length < 1 || skillIds.length > limit || skillIds.some((id) => typeof id !== "string") || new Set(skillIds).size !== skillIds.length) return { ok: false, code: "INVALID_SKILL_SELECTION", skills: [] };
      selected = skillIds.map((id) => skillRegistry.get(id)).filter(Boolean);
      if (selected.length !== skillIds.length) return { ok: false, code: "SKILL_NOT_FOUND", skills: [] };
    } else {
      selected = skillRegistry.search(task, { limit, requiredTags });
    }
    if (!selected.length) return { ok: false, code: "NO_RELEVANT_SKILL", skills: [] };
    const loaded = [];
    for (const item of selected) {
      let doc;
      try { doc = await skillRegistry.load(item.id); }
      catch { return { ok: false, code: "SKILL_LOAD_FAILED", skills: [] }; }
      if (!doc) continue;
      loaded.push({
        id: doc.id,
        version: doc.version,
        description: doc.description,
        content: doc.content,
        source: doc.source,
        score: item.score ?? null,
        matchedTerms: item.matchedTerms ?? [],
        trust: "untrusted_reference",
      });
    }
    if (!loaded.length) return { ok: false, code: "SKILL_CONTENT_UNAVAILABLE", skills: [] };
    return { ok: true, primarySkillId: loaded+0].id, skills: loaded, selectedCount: loaded.length };
  }

  async function run({ task, skillIds, limit = maxSelectedSkills, requiredTags = [], input = {}, plan, ...runOptions } = {}) {
    if (!agentLoop) return { ok: false, code: "AGENT_LOOP_REQUIRED", steps: 0, toolCalls: 0 };
    if (typeof plan !== "function") return { ok: false, code: "PLANNER_REQUIRED", steps: 0, toolCalls: 0 };
    const prepared = await prepare({ task, skillIds, limit, requiredTags });
    if (!prepared.ok) return { ok: false, code: prepared.code, steps: 0, toolCalls: 0 };
    const primary = prepared.skills[0];
    const supportingSkills = prepared.skills.slice(1).map(({ content, ...metadata }) => ({ ...metadata, content }));
    const wrappedPlan = (context) => plan({
      ...context,
      task,
      selectedSkills: [primary, ...supportingSkills],
      instructionTrust: "untrusted_reference_only",
    });
    return agentLoop.run({ ...runOptions, skillId: primary.id, input, plan: wrappedPlan });
  }

  return Object.freeze({ prepare, run });
}
