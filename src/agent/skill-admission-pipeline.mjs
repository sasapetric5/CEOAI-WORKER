// End-to-end intake orchestration: Firewall -> Evaluator -> Quality Gate -> Registry admission.
// Candidate content remains data; execution is delegated only to trusted isolated adapters.
const REVIEW_KEYS = Object.freeze([
  "sourcePinned", "licenseVerified", "hashVerified", "dependenciesReviewed",
  "scriptsReviewed", "networkReviewed", "credentialsReviewed"
]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function createSkillAdmissionPipeline({
  securityFirewall, skillLifecycle, qualityEvaluator, verifyIntakeReview, refreshRegistry
} = {}) {
  if (!securityFirewall || typeof securityFirewall.scan !== "function") throw new TypeError("SKILL_SECURITY_FIREWALL_REQUIRED");
  if (!skillLifecycle || !["discover", "get", "classifyCost", "recordSecurityReview", "recordFailure", "approveForActivation", "isSelectable"]
    .every(name => typeof skillLifecycle[name] === "function")) throw new TypeError("SKILL_LIFECYCLE_REQUIRED");
  if (!qualityEvaluator || typeof qualityEvaluator.evaluate !== "function") throw new TypeError("SKILL_QUALITY_EVALUATOR_REQUIRED");
  if (typeof verifyIntakeReview !== "function") throw new TypeError("TRUSTED_INTAKE_REVIEW_VERIFIER_REQUIRED");

  async function isolate(id, stage, code, severity = "quarantine") {
    let result;
    try { result = await skillLifecycle.recordFailure(id, { stage, code, severity }); }
    catch { return { ok: false, code: "SKILL_ISOLATION_PERSISTENCE_FAILED", isolated: false }; }
    return { ok: false, code, isolated: result?.ok === true, lifecycleStatus: result?.record?.status ?? null };
  }

  async function admit({
    candidate, content, files, contentSha256, bundleSha256, costStatus = "free",
    reviewEvidence, runId, taskCategory = "general", cases
  } = {}) {
    if (!plain(candidate) || typeof candidate.id !== "string" ||
        typeof content !== "string" || !Array.isArray(files) ||
        !["free", "paid", "unknown"].includes(costStatus)) {
      return { ok: false, code: "INVALID_SKILL_ADMISSION_REQUEST", isolated: false };
    }
    let record;
    try { record = await skillLifecycle.get(candidate.id); }
    catch { return { ok: false, code: "SKILL_LIFECYCLE_UNAVAILABLE", isolated: false }; }
    if (!record) {
      let discovered;
      try { discovered = await skillLifecycle.discover({ id: candidate.id, metadata: { candidate } }); }
      catch { return { ok: false, code: "SKILL_DISCOVERY_PERSISTENCE_FAILED", isolated: false }; }
      if (!discovered?.ok) return { ok: false, code: discovered?.code || "SKILL_DISCOVERY_FAILED", isolated: false };
    } else if (["ACTIVE", "REJECTED", "REVOKED"].includes(record.status)) {
      return { ok: false, code: "SKILL_NOT_ELIGIBLE_FOR_REINTAKE", isolated: false };
    }

    let cost;
    try { cost = await skillLifecycle.classifyCost(candidate.id, costStatus); }
    catch { return isolate(candidate.id, "cost", "COST_POLICY_CHECK_FAILED"); }
    if (!cost?.ok) {
      const severity = cost?.record?.status === "REJECTED" ? "reject" : "quarantine";
      return isolate(candidate.id, "cost", cost?.code || "COST_POLICY_REJECTED", severity);
    }
    if (costStatus !== "free") return isolate(candidate.id, "cost", "NON_FREE_OR_UNKNOWN_COST", costStatus === "paid" ? "reject" : "quarantine");

    let security;
    try {
      security = await securityFirewall.scan({ candidate, content, files, contentSha256, bundleSha256 });
    } catch {
      return isolate(candidate.id, "security", "SECURITY_FIREWALL_ERROR");
    }
    if (!security?.ok) {
      const severity = security?.severity === "reject" || security?.code === "CRITICAL_SECURITY_FINDING" ? "reject" : "quarantine";
      return isolate(candidate.id, "security", security?.code || "SECURITY_FIREWALL_REJECTED", severity);
    }

    let review;
    try { review = plain(reviewEvidence) && Object.keys(reviewEvidence).length > 0
      ? await verifyIntakeReview({ candidate, reviewEvidence, security }) : null; }
    catch { review = null; }
    if (!plain(review) || REVIEW_KEYS.some(key => review[key] !== true) ||
        Object.keys(review).some(key => !REVIEW_KEYS.includes(key))) {
      return isolate(candidate.id, "security", "INDEPENDENT_INTAKE_REVIEW_FAILED");
    }
    let savedReview;
    try { savedReview = await skillLifecycle.recordSecurityReview(candidate.id, review); }
    catch { return isolate(candidate.id, "security", "SECURITY_EVIDENCE_PERSISTENCE_FAILED"); }
    if (!savedReview?.ok) return isolate(candidate.id, "security", savedReview?.code || "SECURITY_EVIDENCE_REJECTED");

    let quality;
    try {
      quality = await qualityEvaluator.evaluate({ skillId: candidate.id, runId, taskCategory, cases, expectedContentSha256: contentSha256, candidateSkill: { id: candidate.id, version: candidate.version, description: candidate.description, content } });
    } catch {
      return isolate(candidate.id, "quality", "QUALITY_EVALUATOR_ERROR");
    }
    if (!quality?.ok || quality.qualityPassed !== true || quality.lifecycleStatus !== "VERIFIED") {
      return isolate(candidate.id, "quality", quality?.code || "QUALITY_GATE_FAILED");
    }
    return {
      ok: true,
      skillId: candidate.id,
      securityStatus: "clean",
      qualityStatus: "passed",
      registryStatus: "VERIFIED",
      activation: "owner_approval_required",
      quality
    };
  }

  async function approveForRegistry(skillId, { approvedByOwner = false } = {}) {
    let result;
    try { result = await skillLifecycle.approveForActivation(skillId, { approvedByOwner }); }
    catch { return { ok: false, code: "REGISTRY_ADMISSION_PERSISTENCE_FAILED" }; }
    if (!result?.ok) return result;
    if (typeof refreshRegistry === "function") {
      try { await refreshRegistry(); }
      catch { return { ok: false, code: "REGISTRY_REFRESH_FAILED", lifecycleStatus: result.record?.status ?? "ACTIVE" }; }
    }
    return {
      ok: true,
      skillId,
      registryStatus: "ACTIVE",
      selectable: skillLifecycle.isSelectable(result.record) === true,
      registryRefreshed: typeof refreshRegistry === "function"
    };
  }

  return Object.freeze({
    admit,
    approveForRegistry,
    isSelectable: record => skillLifecycle.isSelectable(record)
  });
}
