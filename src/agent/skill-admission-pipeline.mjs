// End-to-end intake orchestration: Firewall -> Evaluator -> Quality Gate -> Registry admission.
// Candidate content remains data; execution is delegated only to trusted isolated adapters.
const REVIEW_KEYS = Object.freeze([
  "sourcePinned", "licenseVerified", "hashVerified", "dependenciesReviewed",
  "scriptsReviewed", "networkReviewed", "credentialsReviewed"
]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("SKILL_HASH_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

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
        typeof bundleSha256 !== "string" || !/^[a-f0-9]{64}$/.test(bundleSha256) ||
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

    let verifiedContentSha256;
    try { verifiedContentSha256 = await sha256(content); }
    catch { return isolate(candidate.id, "security", "SKILL_HASH_UNAVAILABLE"); }
    if (verifiedContentSha256 !== contentSha256) {
      return isolate(candidate.id, "security", "CANDIDATE_CONTENT_HASH_MISMATCH", "reject");
    }

    let security;
    try {
      security = await securityFirewall.scan({ candidate, content, files, contentSha256: verifiedContentSha256, bundleSha256 });
    } catch {
      return isolate(candidate.id, "security", "SECURITY_FIREWALL_ERROR");
    }
    if (!security?.ok || security.status !== "clean" ||
        security.contentSha256 !== verifiedContentSha256 || security.bundleSha256 !== bundleSha256) {
      const severity = security?.severity === "reject" || security?.code === "CRITICAL_SECURITY_FINDING" ? "reject" : "quarantine";
      return isolate(candidate.id, "security", security?.code || "SECURITY_REPORT_BINDING_FAILED", severity);
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
      quality = await qualityEvaluator.evaluate({ skillId: candidate.id, runId, taskCategory, cases, expectedContentSha256: verifiedContentSha256, candidateSkill: { id: candidate.id, version: candidate.version, description: candidate.description, content } });
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
    if (approvedByOwner !== true) {
      try { return await skillLifecycle.approveForActivation(skillId, { approvedByOwner: false }); }
      catch { return { ok: false, code: "REGISTRY_ADMISSION_PERSISTENCE_FAILED" }; }
    }
    if (typeof refreshRegistry !== "function") return { ok: false, code: "REGISTRY_REFRESH_UNAVAILABLE" };
    let result;
    try { result = await skillLifecycle.approveForActivation(skillId, { approvedByOwner: true }); }
    catch { return { ok: false, code: "REGISTRY_ADMISSION_PERSISTENCE_FAILED" }; }
    if (!result?.ok) return result;
    try {
      const refreshed = await refreshRegistry();
      if (refreshed?.ok === false) throw new Error("REGISTRY_REFRESH_FAILED");
    } catch {
      try { await skillLifecycle.recordFailure(skillId, { stage: "registry", code: "REGISTRY_REFRESH_FAILED", severity: "quarantine" }); } catch {}
      return { ok: false, code: "REGISTRY_REFRESH_FAILED", lifecycleStatus: "SUSPENDED" };
    }
    const selectable = skillLifecycle.isSelectable(result.record) === true;
    if (!selectable) {
      try { await skillLifecycle.recordFailure(skillId, { stage: "registry", code: "REGISTRY_SELECTION_VERIFICATION_FAILED", severity: "quarantine" }); } catch {}
      return { ok: false, code: "REGISTRY_SELECTION_VERIFICATION_FAILED", lifecycleStatus: "SUSPENDED" };
    }
    return { ok: true, skillId, registryStatus: "ACTIVE", selectable: true, registryRefreshed: true };
  }

  return Object.freeze({
    admit,
    approveForRegistry,
    isSelectable: record => skillLifecycle.isSelectable(record)
  });
}
