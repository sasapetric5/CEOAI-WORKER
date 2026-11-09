// Fail-closed composition of source intake, independent review, functional evaluation and lifecycle.
import { verifySkillIntake } from "./supply-chain-shield.mjs";
import { createSkillRegistry } from "./skill-registry.mjs";
import { createSkillQualityEvaluator } from "./skill-quality-evaluator.mjs";

const LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const fail = code => ({ ok: false, code });
async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function staticReview(files, content) {
  const names = files.map(path => path.slice(path.lastIndexOf("/") + 1).toLowerCase());
  const manifests = names.filter(name => ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
    "requirements.txt", "pyproject.toml", "cargo.toml", "go.mod", "gemfile", "composer.json"].includes(name));
  const executables = files.filter(path => /\.(sh|bash|ps1|bat|cmd|js|mjs|cjs|py|rb|php|go|rs)$/i.test(path));
  const codeFences = [...content.matchAll(/^\s*```(?:bash|sh|shell|powershell|javascript|js|python|py|ruby|php|go|rust)\s*$/gim)].length;
  return { dependenciesReviewed: manifests.length === 0, scriptsReviewed: executables.length === 0 && codeFences === 0,
    networkReviewed: executables.length === 0 && codeFences === 0,
    credentialsReviewed: executables.length === 0 && codeFences === 0,
    manifests, executables, codeFences };
}

export function createSkillGovernancePipeline({
  source, lifecycle, costVerifier, reviewCandidate, testCasesForSkill, executeCase, now = () => Date.now()
} = {}) {
  if (!source || typeof source.discover !== "function" || typeof source.fetchCandidate !== "function")
    throw new TypeError("PINNED_SKILL_SOURCE_REQUIRED");
  if (!lifecycle || !["discover", "classifyCost", "recordSecurityReview", "recordQualityResult", "beginRecovery", "get"].every(k => typeof lifecycle[k] === "function"))
    throw new TypeError("SKILL_LIFECYCLE_REQUIRED");
  if (typeof costVerifier !== "function") throw new TypeError("TRUSTED_COST_VERIFIER_REQUIRED");
  if (typeof reviewCandidate !== "function") throw new TypeError("TRUSTED_SECURITY_REVIEWER_REQUIRED");
  if (typeof testCasesForSkill !== "function") throw new TypeError("TRUSTED_TEST_CASE_PROVIDER_REQUIRED");
  if (typeof executeCase !== "function") throw new TypeError("TRUSTED_ISOLATED_SKILL_RUNNER_REQUIRED");
  const noTools = Object.freeze({ get: () => null });

  async function process(candidate, recovery = false) {
    let fetched;
    try { fetched = await source.fetchCandidate(candidate); } catch { return fail("SKILL_SOURCE_FETCH_FAILED"); }
    if (!fetched?.ok) return fail(fetched?.code || "SKILL_SOURCE_FETCH_FAILED");
    const c = fetched.candidate;
    if (!plain(c) || typeof c.id !== "string" || !/^[a-z][a-z0-9_]{0,47}$/.test(c.id) ||
        typeof c.repository !== "string" || typeof c.path !== "string" ||
        !SHA1.test(c.commit || "") || !SHA1.test(c.blobSha || "")) return fail("INVALID_PINNED_CANDIDATE");
    const metadata = { repository: c.repository, path: c.path, commit: c.commit, blobSha: c.blobSha, license: fetched.license };
    if (!recovery) {
      const created = await lifecycle.discover({ id: c.id, metadata });
      if (!created.ok) return created;
    } else {
      const current = await lifecycle.get(c.id);
      if (!current || current.status !== "QUARANTINED") return fail("RECOVERY_NOT_IN_QUARANTINE");
    }

    let cost;
    try { cost = await costVerifier({ candidate: c, content: fetched.content, license: fetched.license }); }
    catch { cost = null; }
    const costStatus = cost?.status === "free" ? "free" : cost?.status === "paid" ? "paid" : "unknown";
    const costResult = await lifecycle.classifyCost(c.id, costStatus);
    if (!costResult.ok) return costResult;
    if (costStatus !== "free") return fail(costStatus === "paid" ? "PAID_SKILL_REJECTED" : "COST_UNVERIFIED_QUARANTINED");

    const contentSha256 = await hash(fetched.content);
    const intake = await verifySkillIntake({
      id: c.id, version: "1.0.0", description: "External skill from pinned approved repository",
      content: fetched.content, contentSha256,
      source: { repository: c.repository, path: c.path, license: fetched.license, commit: c.commit, blobSha: c.blobSha }
    }, { approvedRepositories: source.approvedRepositories || [], approvedLicenses: [...LICENSES] });
    if (!intake.ok) return fail(intake.code);

    const staticChecks = staticReview(fetched.files || [], fetched.content);
    let independent;
    try { independent = await reviewCandidate({ candidate: c, content: fetched.content, license: fetched.license,
      files: Object.freeze([...(fetched.files || [])]), staticChecks: Object.freeze(staticChecks) }); }
    catch { return fail("INDEPENDENT_SECURITY_REVIEW_FAILED"); }
    const review = {
      sourcePinned: true, licenseVerified: LICENSES.has(fetched.license), hashVerified: intake.contentTrust === "sha256_verified",
      dependenciesReviewed: staticChecks.dependenciesReviewed && independent?.dependenciesReviewed === true,
      scriptsReviewed: staticChecks.scriptsReviewed && independent?.scriptsReviewed === true,
      networkReviewed: staticChecks.networkReviewed && independent?.networkReviewed === true,
      credentialsReviewed: staticChecks.credentialsReviewed && independent?.credentialsReviewed === true
    };
    if (!Object.values(review).every(Boolean)) return fail("SECURITY_REVIEW_INCOMPLETE");
    const secured = await lifecycle.recordSecurityReview(c.id, review);
    if (!secured.ok) return secured;

    let cases;
    try { cases = await testCasesForSkill({ id: c.id, content: fetched.content, source: metadata }); }
    catch { return fail("SKILL_TEST_CASES_UNAVAILABLE"); }
    const registry = createSkillRegistry({ toolRegistry: noTools, skills: [{
      id: c.id, version: "1.0.0", description: "External skill from pinned approved repository",
      allowedToolIds: [], content: fetched.content, source: metadata, contentSha256
    }] });
    const evaluator = createSkillQualityEvaluator({ skillRegistry: registry, skillLifecycle, executeCase, now });
    const runId = "skill-" + (await hash(c.repository + "/" + c.path + "/" + c.commit + "/" + now())).slice(0, 32);
    const evaluation = await evaluator.evaluate({ skillId: c.id, runId, taskCategory: "external_skill", cases });
    if (!evaluation.ok) return evaluation;
    return { ok: true, id: c.id, status: evaluation.lifecycleStatus, score: evaluation.score,
      passed: evaluation.passed, total: evaluation.total, activated: false, source: metadata, staticChecks };
  }

  async function runBatch({ limit = 20 } = {}) {
    let candidates;
    try { candidates = await source.discover({ limit }); } catch { return fail("SKILL_DISCOVERY_FAILED"); }
    if (!Array.isArray(candidates)) return fail("INVALID_DISCOVERY_RESULT");
    const results = [];
    for (const candidate of candidates) results.push(await process(candidate));
    return { ok: results.every(x => x.ok), discovered: candidates.length,
      verified: results.filter(x => x.ok && x.status === "VERIFIED").length,
      quarantined: results.filter(x => !x.ok).length, results };
  }

  async function recover(skillId, { approvedByOwner = false } = {}) {
    const record = await lifecycle.get(skillId);
    if (!record) return fail("SKILL_NOT_FOUND");
    const started = await lifecycle.beginRecovery(skillId, { approvedByOwner });
    if (!started.ok) return started;
    const m = record.metadata;
    if (!m || !SHA1.test(m.commit || "") || !SHA1.test(m.blobSha || "")) return fail("RECOVERY_SOURCE_METADATA_UNAVAILABLE");
    return process({ id: skillId, repository: m.repository, path: m.path, commit: m.commit, blobSha: m.blobSha }, true);
  }

  return Object.freeze({ runBatch, recover });
}
