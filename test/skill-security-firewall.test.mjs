import test from "node:test";
import assert from "node:assert/strict";
import { createSkillSecurityFirewall, evaluateSkillSecurityReport, REQUIRED_SKILL_SCANNERS } from "../src/agent/skill-security-firewall.mjs";

const digest = "a".repeat(64);
const bundleDigest = "d".repeat(64);
const candidate = { id: "candidate", repository: "trusted/skills", path: "skills/demo/SKILL.md", commit: "b".repeat(40), blobSha: "c".repeat(40) };
const cleanReport = () => ({
  schemaVersion: 1,
  policyVersion: "ceoai-skill-firewall-v1",
  candidate,
  runId: "scan-run-0001",
  scannedAt: "2026-11-09T18:00:00.000Z",
  attestation: { envelope: "trusted-ci-attestation-envelope" },
  contentSha256: digest,
  bundleSha256: bundleDigest,
  scans: REQUIRED_SKILL_SCANNERS.map(scanner => ({ scanner, version: "1.0.0", status: "clean", findings: [] }))
});

test("accepts only complete clean scanner reports bound to the exact skill hash", () => {
  const result = evaluateSkillSecurityReport(cleanReport(), { expectedContentSha256: digest, expectedBundleSha256: bundleDigest, expectedCandidate: candidate });
  assert.equal(result.ok, true);
  assert.equal(result.status, "clean");
  assert.equal(result.bundleSha256, bundleDigest);
  assert.equal(result.scanners.length, REQUIRED_SKILL_SCANNERS.length);
});

test("rejects reports with a mismatched content hash or missing scanner", () => {
  assert.equal(evaluateSkillSecurityReport(cleanReport(), { expectedContentSha256: "b".repeat(64), expectedBundleSha256: bundleDigest, expectedCandidate: candidate }).code,
    "INVALID_OR_UNBOUND_SECURITY_REPORT");
  const report = cleanReport();
  report.scans.pop();
  assert.equal(evaluateSkillSecurityReport(report, { expectedContentSha256: digest, expectedBundleSha256: bundleDigest, expectedCandidate: candidate }).code, "REQUIRED_SCANNER_MISSING");
});

test("critical findings reject and high or medium findings quarantine", () => {
  const critical = cleanReport();
  critical.scans[0] = { ...critical.scans[0], status: "findings", findings: [{ severity: "critical", code: "MALWARE_SIGNATURE" }] };
  assert.equal(evaluateSkillSecurityReport(critical, { expectedContentSha256: digest, expectedBundleSha256: bundleDigest, expectedCandidate: candidate }).severity, "reject");
  const high = cleanReport();
  high.scans[1] = { ...high.scans[1], status: "findings", findings: [{ severity: "high", code: "UNSAFE_EVAL" }] };
  assert.equal(evaluateSkillSecurityReport(high, { expectedContentSha256: digest, expectedBundleSha256: bundleDigest, expectedCandidate: candidate }).severity, "quarantine");
});

test("unavailable scanners and inconsistent scanner outputs fail closed", () => {
  const unavailable = cleanReport();
  unavailable.scans[0] = { ...unavailable.scans[0], status: "unavailable" };
  assert.equal(evaluateSkillSecurityReport(unavailable, { expectedContentSha256: digest, expectedBundleSha256: bundleDigest, expectedCandidate: candidate }).code, "SCANNER_UNAVAILABLE");
  const inconsistent = cleanReport();
  inconsistent.scans[0] = { ...inconsistent.scans[0], findings: [{ severity: "low", code: "NOTE" }] };
  assert.equal(evaluateSkillSecurityReport(inconsistent, { expectedContentSha256: digest, expectedBundleSha256: bundleDigest, expectedCandidate: candidate }).code, "INCONSISTENT_SCANNER_RESULT");
});

test("firewall treats scanner adapter failure as a closed gate and never requests candidate execution", async () => {
  const firewall = createSkillSecurityFirewall({
    trustRootProvider: { async loadTrustedRoot({ candidateId }) {
      assert.equal(candidateId, candidate.id);
      return { ok: true, target: new Uint8Array([1, 2, 3]), rootVersion: 16, cacheRevision: 1 };
    } },
    verifyAttestation: async (_report, context) => {
      assert.deepEqual(context.trustedRoot, new Uint8Array([1, 2, 3]));
      assert.equal(context.trustedRootVersion, 16);
      return true;
    },
    scanCandidate: async input => {
      assert.equal(input.executeCandidateCode, false);
      assert.equal(input.networkAccessForCandidate, false);
      assert.equal(input.secretAccessForCandidate, false);
      return cleanReport();
    }
  });
  const result = await firewall.scan({ candidate, content: "untrusted", files: ["SKILL.md"], contentSha256: digest, bundleSha256: bundleDigest });
  assert.equal(result.ok, true);
  const failing = createSkillSecurityFirewall({
    trustRootProvider: { async loadTrustedRoot() { return { ok: true, target: new Uint8Array([1]) }; } },
    verifyAttestation: async () => true,
    scanCandidate: async () => { throw new Error("scanner offline"); }
  });
  assert.equal((await failing.scan({ candidate, content: "untrusted", files: [], contentSha256: digest, bundleSha256: bundleDigest })).code,
    "SECURITY_SCANNER_EXECUTION_FAILED");
});

test("rejects scanner reports without a valid trusted CI attestation", async()=>{
 const firewall=createSkillSecurityFirewall({
  trustRootProvider:{async loadTrustedRoot(){return {ok:true,target:new Uint8Array([1]),rootVersion:16,cacheRevision:2};}},
  scanCandidate:async()=>cleanReport(),
  verifyAttestation:async(_report,context)=>{assert.deepEqual(context.trustedRoot,new Uint8Array([1]));return false;}
 });
 const result=await firewall.scan({candidate,content:"untrusted",files:["SKILL.md"],contentSha256:digest,bundleSha256:bundleDigest});
 assert.equal(result.code,"UNTRUSTED_SCAN_ATTESTATION");
});

test("records scanners with explicit non-applicability separately from unavailable scanners",()=>{
 const report=cleanReport();
 report.scans[1]={scanner:"semgrep",version:"1.2.3",status:"not_applicable",applicabilityReason:"No source code in this Skill bundle",findings:[]};
 report.scans[2]={scanner:"codeql",version:"2.20.0",status:"not_applicable",applicabilityReason:"No supported source files",findings:[]};
 report.scans[4]={scanner:"owasp_dep_scan",version:"1.0.0",status:"not_applicable",applicabilityReason:"No dependency manifest",findings:[]};
 const accepted=evaluateSkillSecurityReport(report,{expectedContentSha256:digest,expectedBundleSha256:bundleDigest,expectedCandidate:candidate});
 assert.equal(accepted.ok,true);
 report.scans[0]={...report.scans[0],status:"unavailable"};
 assert.equal(evaluateSkillSecurityReport(report,{expectedContentSha256:digest,expectedBundleSha256:bundleDigest,expectedCandidate:candidate}).code,"SCANNER_UNAVAILABLE");
});


test("accepts real scanner version strings with bounded build metadata",()=>{
 const report=cleanReport();
 report.scans=report.scans.map((scan,index)=>({
  ...scan,
  version:["ClamAV 1.5.4/28178/Mon Nov 9 06:24:16 2026","1.184.0","CodeQL CLI v2.20.3","gitleaks version 8.24.2","depscan 6.3.1"][index],
  status:index===1||index===2||index===4?"not_applicable":"clean",
  ...(index===1?{applicabilityReason:"No source code"}:{}),
  ...(index===2?{applicabilityReason:"No supported source"}:{}),
  ...(index===4?{applicabilityReason:"No dependency manifest"}:{})
 }));
 const result=evaluateSkillSecurityReport(report,{expectedContentSha256:digest,expectedBundleSha256:bundleDigest,expectedCandidate:candidate});
 assert.equal(result.ok,true);
});


test("firewall fails closed before Sigstore verification when TUF trust root cannot be verified", async () => {
  let verifierCalled = false;
  const firewall = createSkillSecurityFirewall({
    trustRootProvider: { async loadTrustedRoot() { const error = new Error("TUF_METADATA_VERIFICATION_FAILED"); error.code = error.message; throw error; } },
    scanCandidate: async () => cleanReport(),
    verifyAttestation: async () => { verifierCalled = true; return true; },
  });
  const result = await firewall.scan({ candidate, content: "untrusted", files: ["SKILL.md"], contentSha256: digest, bundleSha256: bundleDigest });
  assert.equal(result.code, "TUF_METADATA_VERIFICATION_FAILED");
  assert.equal(verifierCalled, false);
});

test("firewall requires the TUF trust-root provider and a bounded verified target", async () => {
  assert.throws(() => createSkillSecurityFirewall({
    scanCandidate: async () => cleanReport(), verifyAttestation: async () => true,
  }), /SIGSTORE_TUF_TRUST_ROOT_PROVIDER_REQUIRED/);
  const firewall = createSkillSecurityFirewall({
    trustRootProvider: { async loadTrustedRoot() { return { ok: true, target: new Uint8Array(0), rootVersion: 16 }; } },
    scanCandidate: async () => cleanReport(),
    verifyAttestation: async () => true,
  });
  const result = await firewall.scan({ candidate, content: "untrusted", files: ["SKILL.md"], contentSha256: digest, bundleSha256: bundleDigest });
  assert.equal(result.code, "SIGSTORE_TUF_TRUST_ROOT_INVALID");
});
