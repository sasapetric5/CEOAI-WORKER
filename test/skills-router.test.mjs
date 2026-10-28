import test from "node:test";
import assert from "node:assert/strict";
import { selectSkillCandidates, loadSkillRegistry } from "../src/v5-modules/skills-router.mjs";

test("skill router returns relevant candidates without enabling them", async () => {
  const registry = await loadSkillRegistry();
  const candidates = selectSkillCandidates(registry, "technical SEO audit structured data");
  assert.ok(candidates.some((item) => item.id === "seo-audit"));
  assert.ok(candidates.length <= registry.routing_policy.default_max_skills_per_task);
  assert.ok(candidates.every((item) => item.eligible_for_execution === false));
  assert.ok(candidates.every((item) => item.runtime_status === "not-enabled"));
});

test("skill router is deterministic and respects maxSkills", async () => {
  const registry = await loadSkillRegistry();
  const first = selectSkillCandidates(registry, "customer research public sources", { maxSkills: 1 });
  const second = selectSkillCandidates(registry, "customer research public sources", { maxSkills: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, "customer-research");
});

test("skill router safely handles empty requests and rejects unsafe limits", async () => {
  const registry = await loadSkillRegistry();
  assert.deepEqual(selectSkillCandidates(registry, "   "), []);
  assert.throws(() => selectSkillCandidates(registry, "seo", { maxSkills: 0 }), RangeError);
  assert.throws(() => selectSkillCandidates(registry, "seo", { maxSkills: 9 }), RangeError);
});

test("execution eligibility requires all review gates", () => {
  const registry = {
    library_id: "ceoai-shared-skills",
    routing_policy: { default_max_skills_per_task: 4 },
    categories: [{ id: "dev", label: "Development", tags: ["coding"] }],
    skills: [{
      id: "code-review", name: "Code review", path: "skills/code-review/SKILL.md",
      category: "dev", tags: ["review"], intents: ["coding"],
      runtime_status: "enabled", license_status: "approved",
      security_status: "verified", external_actions: false
    }]
  };
  assert.equal(selectSkillCandidates(registry, "code review")[0].eligible_for_execution, true);
  registry.skills[0].security_status = "pending";
  assert.equal(selectSkillCandidates(registry, "code review")[0].eligible_for_execution, false);
});
