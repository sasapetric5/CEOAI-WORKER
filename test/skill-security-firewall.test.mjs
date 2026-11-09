import test from "node:test";
import assert from "node:assert/strict";
import { createSkillSecurityFirewall, evaluateSkillSecurityReport, REQUIRED_SKILL_SCANNERS } from "../src/agent/skill-security-firewall.mjs";

const digest = "a".repeat(64);
const candidate = { id: "candidate", repository: "trusted/skills", path: "skills/demo/SKILL.md", commit: "b".repeat(40), blobSha: "c".repeat(40) };
const cleanReport = () => ({
  schemaVersion: 1,
  policyVersion: "ceoai-skill-firewall-v1",
  candidate,
  runId: "scan-run-0001",
  scannedAt: "2026-11-09T18:00:00.000Z",
  contentSha256: digest,
  scans: REQUIRED_SKILL_SCANNERS.map(scanner => ({ scanner, version: "1.0.0", status: "clean", findings: [] }))
});

test("accepts only complete clean scanner reports bound to the exact skill hash", () => {
  const result = evaluateSkillSecurityReport(cleanReport(), { expectedContentSha256: digest, expectedCandidate: candidate });
  assert.equal(result.ok, true);
  assert.equal(result.status, "clean");
  assert.equal(result.scanners.length, REQUIRED_SKILL_SCANNERS.length);
});

test("rejects reports with a mismatched content hash or missing scanner", () => {
  assert.equal(evaluateSkillSecurityReport(cleanReport(), { expectedContentSha256: "b".repeat(64), expectedCandidate: candidate }).code,
    "INVALID_OR_UNBOUND_SECURITY_REPORT");
  const report = cleanReport();
  report.scans.pop();
  assert.equal(evaluateSkillSecurityReport(report, { expectedContentSha256: digest, expectedCandidate: candidate }).code, "REQUIRED_SCANNER_MISSING");
});

test("critical findings reject and high or medium findings quarantine", () => {
  const critical = cleanReport();
  critical.scans[0] = { ...critical.scans[0], status: "findings", findings: [{ severity: "critical", code: "MALWARE_SIGNATURE" }] };
  assert.equal(evaluateSkillSecurityReport(critical, { expectedContentSha256: digest, expectedCandidate: candidate }).severity, "reject");
  const high = cleanReport();
  high.scans[1] = { ...high.scans[1], status: "findings", findings: [{ severity: "high", code: "UNSAFE_EVAL" }] };
  assert.equal(evaluateSkillSecurityReport(high, { expectedContentSha256: digest, expectedCandidate: candidate }).severity, "quarantine");
});

test("unavailable scanners and inconsistent scanner outputs fail closed", () => {
  const unavailable = cleanReport();
  unavailable.scans[0] = { ...unavailable.scans[0], status: "unavailable" };
  assert.equal(evaluateSkillSecurityReport(unavailable, { expectedContentSha256: digest, expectedCandidate: candidate }).code, "SCANNER_UNAVAILABLE");
  const inconsistent = cleanReport();
  inconsistent.scans[0] = { ...inconsistent.scans[0], findings: [{ severity: "low", code: "NOTE" }] };
  assert.equal(evaluateSkillSecurityReport(inconsistent, { expectedContentSha256: digest, expectedCandidate: candidate }).code, "INCONSISTENT_SCANNER_RESULT");
});

test("firewall treats scanner adapter failure as a closed gate and never requests candidate execution", async () => {
  const firewall = createSkillSecurityFirewall({
    verifyAttestation: async () => true,
    scanCandidate: async input => {
      assert.equal(input.executeCandidateCode, false);
      assert.equal(input.networkAccessForCandidate, false);
      assert.equal(input.secretAccessForCandidate, false);
      return cleanReport();
    }
  });
  const result = await firewall.scan({ candidate, content: "untrusted", files: ["SKILL.md"], contentSha256: digest });
  assert.equal(result.ok, true);
  const failing = createSkillSecurityFirewall({ verifyAttestation: async () => true, scanCandidate: async () => { throw new Error("scanner offline"); } });
  assert.equal((await failing.scan({ candidate: { id: "candidate" }, content: "untrusted", files: [], contentSha256: digest })).code,
    "SECURITY_SCANNER_EXECUTION_FAILED");
});

test("rejects scanner reports without a valid trusted CI attestation", async()=>{
 const firewall=createSkillSecurityFirewall({
  scanCandidate:async()=>cleanReport(),
  verifyAttestation:async()=>false
 });
 const result=await firewall.scan({candidate,content:"untrusted",files:["SKILL.md"],contentSha256:digest});
 assert.equal(result.code,"UNTRUSTED_SCAN_ATTESTATION");
});
