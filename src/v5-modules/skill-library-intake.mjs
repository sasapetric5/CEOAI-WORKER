import { createHash } from "node:crypto";

const APP_GROUPS = Object.freeze({
  ceoai: ["ceoai"],
  contentcraft: ["contentcraft"],
  aiforce: ["aiforce"],
  "rankgeo-safe-automaton": ["rankgeo", "safe-automaton"]
});

const APP_TERMS = Object.freeze({
  ceoai: ["orchestration", "agent", "workflow", "provider", "quota", "routing", "health", "handoff", "evaluation", "retry"],
  contentcraft: ["content", "copywriting", "headline", "editorial", "brand", "marketing", "meta description", "social", "cta"],
  aiforce: ["security", "privacy", "prompt", "injection", "pii", "jailbreak", "structured output", "redaction", "safety"],
  "rankgeo-safe-automaton": ["seo", "site audit", "keyword", "listing", "jsonld", "sitemap", "robots", "redirect", "automation", "permission", "rollback", "incident"]
});

const PRIORITY_TERMS = Object.freeze({
  "software-engineering-and-testing": ["coding", "debugging", "code review", "test", "tdd", "refactor", "api"],
  "security-and-privacy": ["security", "privacy", "secret", "permission", "prompt injection", "pii", "threat"],
  "agent-orchestration-and-quality": ["agent", "orchestration", "handoff", "routing", "health", "evaluation", "retry"],
  "seo-and-site-auditing": ["seo", "indexability", "structured data", "jsonld", "sitemap", "internal link"],
  "research-and-sources": ["research", "source", "fact-check", "citation", "evidence", "freshness"],
  "content-and-marketing": ["content", "copywriting", "headline", "brand voice", "editorial", "marketing"]
});

const BLOCKED_LICENSE_STATES = new Set(["unknown", "incompatible", "rejected", "missing"]);
const BLOCKED_SECURITY_STATES = new Set(["blocked", "rejected", "unsafe", "failed"]);

function normalized(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value) {
  return new Set(normalized(value).split(/\s+/).filter(token => token.length > 2));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common++;
  return common / Math.max(1, Math.min(a.size, b.size));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value).trim()).filter(Boolean))];
}

export function classifySkillCandidate(candidate = {}) {
  const text = normalized([
    candidate.id, candidate.name, candidate.description, candidate.path,
    ...(Array.isArray(candidate.tags) ? candidate.tags : []),
    ...(Array.isArray(candidate.intents) ? candidate.intents : [])
  ].join(" "));
  const scores = Object.entries(PRIORITY_TERMS).map(([category, terms]) => ({
    category,
    score: terms.reduce((sum, term) => sum + (text.includes(normalized(term)) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));
  const best = scores[0];
  const category = candidate.category || (best?.score > 0 ? best.category : "product-and-business-analysis");
  const categoryScore = scores.find(item => item.category === category)?.score ?? 0;
  const appScores = Object.entries(APP_TERMS).map(([app, terms]) => ({
    app,
    score: terms.reduce((sum, term) => sum + (text.includes(normalized(term)) ? 1 : 0), 0)
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.app.localeCompare(b.app));
  const applications = appScores.length ? appScores.map(item => item.app) : ["ceoai"];
  const licenseStatus = normalized(candidate.license_status || "unknown");
  const securityStatus = normalized(candidate.security_status || "pending");
  const hasSource = Boolean(candidate.source?.repository && candidate.source?.ref && candidate.source?.path);
  const blocked = BLOCKED_LICENSE_STATES.has(licenseStatus) || BLOCKED_SECURITY_STATES.has(securityStatus);
  const hardGatePassed = hasSource && !blocked && candidate.external_actions !== true && candidate.paid_services !== true;
  const signals = [
    candidate.name ? 8 : 0,
    candidate.description ? 8 : 0,
    hasSource ? 15 : 0,
    candidate.source?.ref && !["main", "master", "latest", "head"].includes(normalized(candidate.source.ref)) ? 10 : 0,
    candidate.content_hash ? 10 : 0,
    candidate.input_contract && candidate.output_contract ? 10 : 0,
    licenseStatus && !["unknown", "pending", "pending review"].includes(licenseStatus) ? 12 : 0,
    securityStatus === "passed" || securityStatus === "approved" ? 15 : 0,
    candidate.test_status === "passed" ? 12 : 0
  ];
  const readinessScore = Math.min(100, signals.reduce((sum, score) => sum + score, 0));
  const priorityScore = Math.min(100, (categoryScore * 12) + (appScores.length ? Math.min(20, appScores[0].score * 5) : 0) + (candidate.criticality === "high" ? 20 : 0));
  const status = !hasSource ? "needs-provenance" : blocked ? "blocked-review" :
    !candidate.license_status || licenseStatus === "unknown" ? "license-review" :
    !candidate.content_hash || !candidate.source?.ref ? "needs-pinning" :
    candidate.security_status !== "passed" && candidate.security_status !== "approved" ? "security-review" :
    candidate.test_status !== "passed" ? "testing-required" : "eligible-for-owner-review";
  return {
    id: String(candidate.id || ""),
    category,
    applications,
    priority_score: priorityScore,
    readiness_score: readinessScore,
    status,
    hard_gate_passed: hardGatePassed,
    missing: [
      !candidate.name ? "name" : null,
      !candidate.description ? "description" : null,
      !hasSource ? "source.repository/ref/path" : null,
      !candidate.content_hash ? "content_hash" : null,
      !candidate.license_status || licenseStatus === "unknown" ? "license_review" : null,
      candidate.security_status !== "passed" && candidate.security_status !== "approved" ? "security_review" : null,
      candidate.test_status !== "passed" ? "tests" : null,
      !(candidate.input_contract && candidate.output_contract) ? "input/output_contract" : null
    ].filter(Boolean)
  };
}

export function deduplicateSkillCandidates(candidates = []) {
  const seenIds = new Set();
  const seenHashes = new Map();
  const seenSources = new Map();
  const kept = [];
  const duplicates = [];
  for (const candidate of candidates) {
    const id = normalized(candidate.id);
    const hash = normalized(candidate.content_hash);
    const sourceKey = [candidate.source?.repository, candidate.source?.ref, candidate.source?.path].map(normalized).join(":");
    let reason = null;
    let duplicateOf = null;
    if (!id) reason = "missing-id";
    else if (seenIds.has(id)) { reason = "duplicate-id"; duplicateOf = id; }
    else if (hash && seenHashes.has(hash)) { reason = "duplicate-content-hash"; duplicateOf = seenHashes.get(hash); }
    else if (candidate.source?.repository && candidate.source?.ref && candidate.source?.path && seenSources.has(sourceKey)) { reason = "duplicate-source"; duplicateOf = seenSources.get(sourceKey); }
    if (reason) {
      duplicates.push({ id: String(candidate.id || ""), reason, duplicate_of: duplicateOf });
      continue;
    }
    seenIds.add(id);
    if (hash) seenHashes.set(hash, id);
    if (candidate.source?.repository && candidate.source?.ref && candidate.source?.path) seenSources.set(sourceKey, id);
    kept.push(candidate);
  }
  return { candidates: kept, duplicates };
}

export function buildSkillIntakeReport(candidates = []) {
  const deduped = deduplicateSkillCandidates(candidates);
  const classified = deduped.candidates.map(candidate => ({
    ...classifySkillCandidate(candidate),
    name: String(candidate.name || ""),
    source: candidate.source || null
  })).sort((a, b) => b.priority_score - a.priority_score || b.readiness_score - a.readiness_score || a.id.localeCompare(b.id));
  const summary = {
    input_count: candidates.length,
    unique_count: classified.length,
    duplicate_count: deduped.duplicates.length,
    candidate_count: classified.filter(item => item.status !== "blocked-review").length,
    blocked_count: classified.filter(item => item.status === "blocked-review" || !item.hard_gate_passed).length,
    ready_for_owner_review_count: classified.filter(item => item.status === "eligible-for-owner-review" && item.hard_gate_passed).length,
    runtime_enabled_count: 0,
    by_category: {},
    by_application: {}
  };
  for (const item of classified) {
    summary.by_category[item.category] = (summary.by_category[item.category] || 0) + 1;
    for (const app of item.applications) summary.by_application[app] = (summary.by_application[app] || 0) + 1;
  }
  return { schema_version: "1.0.0", policy: "classification-only-no-import-no-execution", summary, candidates: classified, duplicates: deduped.duplicates };
}

export function createSkillContentHash(content) {
  return createHash("sha256").update(String(content), "utf8").digest("hex");
}

export function selectRelevantSkills(skills = [], task = {}, options = {}) {
  const maxSkills = Math.max(1, Math.min(Number(options.maxSkills ?? 4), 8));
  const taskText = normalized([task.description, task.intent, task.application, ...(task.tags || [])].join(" "));
  const taskTokens = tokens(taskText);
  const app = normalized(task.application);
  const intent = normalized(task.intent);
  const scored = [];
  for (const skill of skills) {
    if (skill.runtime_status !== "enabled" || skill.review_status !== "approved") continue;
    if (BLOCKED_LICENSE_STATES.has(normalized(skill.license_status))) continue;
    if (BLOCKED_SECURITY_STATES.has(normalized(skill.security_status))) continue;
    if (skill.external_actions === true || skill.paid_services === true) continue;
    const allowedApps = uniqueStrings(skill.applications || []);
    if (app && allowedApps.length && !allowedApps.map(normalized).includes(app)) continue;
    const skillText = [skill.name, skill.description, skill.category, ...(skill.tags || []), ...(skill.intents || [])].join(" ");
    const lexical = overlap(taskTokens, tokens(skillText));
    const tagHits = (skill.tags || []).filter(tag => taskTokens.has(normalized(tag))).length;
    const intentMatch = intent && (skill.intents || []).some(value => normalized(value) === intent) ? 0.25 : 0;
    const score = lexical + Math.min(0.35, tagHits * 0.12) + intentMatch;
    if (score > 0) scored.push({ skill, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.skill.id).localeCompare(String(b.skill.id)));
  return scored.slice(0, maxSkills).map(({skill, score}) => ({...skill, relevance_score: Number(score.toFixed(4))}));
}
