// CEOAI task orchestrator: turns a user request into a bounded, auditable plan.
// This module does not execute arbitrary skill instructions or grant tool permissions.
import { selectSkillCandidates } from "./skills-router.mjs";
import { selectTaskAgents } from "./agent-registry.mjs";

const MAX_TASK_CHARS = 2000;
const MAX_STEPS = 6;
const TASK_TYPES = new Set(["coding", "research", "seo", "writing", "analysis", "general"]);

function inferTaskType(request) {
  const p = String(request ?? "").toLocaleLowerCase("sr-Latn");
  if (/\b(seo|sajt|indeks|structured data|meta opis|alt tekst)\b/.test(p)) return "seo";
  if (/\b(kod|program|bug|test|worker|api|repozitorij|implement|ispravi)\w*\b/.test(p)) return "coding";
  if (/\b(istraz|istraž|izvor|pretraž|pretraz|proveri činjenice|proveri cinjenice)\w*\b/.test(p)) return "research";
  if (/\b(napiši|napisi|tekst|sadržaj|sadrzaj|copywriting|email|objava)\w*\b/.test(p)) return "writing";
  if (/\b(analiz|uporedi|proceni|planir|strategij)\w*\b/.test(p)) return "analysis";
  return "general";
}

export function createTaskPlan(registry, request, options = {}) {
  if (typeof request !== "string" || !request.trim() || request.length > MAX_TASK_CHARS) {
    throw new TypeError("Request must be a non-empty string up to 2000 characters");
  }
  const maxSteps = options.maxSteps ?? MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) {
    throw new RangeError("maxSteps must be an integer between 1 and 6");
  }
  const type = inferTaskType(request);
  const maxAgents = options.maxAgents ?? 4;
  const selectedAgents = selectTaskAgents(type, { maxAgents });
  const candidates = selectSkillCandidates(registry, request, { maxSkills: options.maxSkills ?? 4 });
  const eligible = candidates.filter(skill => skill.eligible_for_execution);
  const blocked = candidates.filter(skill => !skill.eligible_for_execution);
  const steps = [
    { id: "classify", status: "ready", description: "Razvrstaj zahtev i definiši kriterijume uspeha." },
    { id: "select", status: "ready", description: "Izaberi relevantne veštine i proveri njihove dozvole." },
    { id: "execute", status: "blocked-plan-only-no-runtime", description: "Izvrši samo odobrene korake preko eksplicitno dozvoljenih alata." },
    { id: "verify", status: "blocked-until-runtime", description: "Proveri rezultat tek kada dozvoljeno izvršavanje bude dostupno." },
    { id: "recover", status: "blocked-until-runtime", description: "Oporavak i ponovni pokušaji zahtevaju dostupan runtime i ograničene dozvole." },
    { id: "report", status: "ready", description: "Prikaži šta je urađeno, testove, greške i preostale blokade." },
  ].slice(0, maxSteps);
  return {
    schema_version: "1.0.0",
    mode: "plan-only",
    task_type: TASK_TYPES.has(type) ? type : "general",
    request_chars: request.length,
    selected_agents: selectedAgents,
    handoff_policy: {
      mode: "planned-only",
      max_agents: maxAgents,
      agent_execution_enabled: false,
      automatic_tool_execution_enabled: false,
      external_actions_allowed: false,
      paid_services_allowed: false,
    },
    steps,
    selected_skills: candidates.map(({ id, name, category, score, runtime_status }) =>
      ({ id, name, category, score, runtime_status })),
    eligible_skill_ids: eligible.map(skill => skill.id),
    blocked_skill_ids: blocked.map(skill => skill.id),
    // Eligibility is not permission to run: this orchestrator is deliberately plan-only.
    skill_execution_eligible: eligible.length > 0,
    execution_allowed: false,
    execution_block_reason: "plan-only-no-runtime-executor",
    health_monitor: {
      provider_health_module: "src/v5-modules/agent-health.mjs",
      recovery_metrics_module: "src/v5-modules/recovery-metrics.mjs",
      metrics_are_diagnostic_only: true,
      raw_prompts_or_secrets_in_metrics: false,
      health_status_grants_execution: false,
    },
    execution_policy: {
      container_policy_module: "src/v5-modules/execution-policy.mjs",
      container_jobs_must_be_validated: true,
      container_executor_available: false,
      execution_started: false,
    },
    external_actions_allowed: false,
    paid_services_allowed: false,
    requires_owner_approval_for_external_actions: true,
  };
}
