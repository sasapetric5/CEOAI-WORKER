// CEOAI Skill Security Firewall: fail-closed validation of trusted scanner attestations.
// Scanner execution belongs in an isolated CI runner; this module never executes candidate code.
export const REQUIRED_SKILL_SCANNERS = Object.freeze([
  "clamav", "semgrep", "codeql", "gitleaks", "owasp_dep_scan"
]);
const SHA256 = /^[a-f0-9]{64}$/;
const SCANNER_ID = /^[a-z][a-z0-9_]{1,31}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,63}$/;
const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
const STATUSES = new Set(["clean", "findings", "unavailable"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = code => Object.freeze({ ok: false, code });

export function evaluateSkillSecurityReport(report, {
  expectedContentSha256,
  requiredScanners = REQUIRED_SKILL_SCANNERS
} = {}) {
  if (!SHA256.test(expectedContentSha256 || "")) return fail("EXPECTED_SKILL_HASH_REQUIRED");
  if (!plain(report) || report.schemaVersion !== 1 ||
      report.contentSha256 !== expectedContentSha256 ||
      !Array.isArray(report.scans) || !Array.isArray(requiredScanners) ||
      requiredScanners.length < 1 || requiredScanners.length > 16 ||
      requiredScanners.some(id => typeof id !== "string" || !SCANNER_ID.test(id)) ||
      new Set(requiredScanners).size !== requiredScanners.length) {
    return fail("INVALID_OR_UNBOUND_SECURITY_REPORT");
  }
  const byId = new Map();
  for (const scan of report.scans) {
    if (!plain(scan) || !SCANNER_ID.test(scan.scanner || "") ||
        !VERSION.test(scan.version || "") || !STATUSES.has(scan.status) ||
        !Array.isArray(scan.findings) || scan.findings.length > 500 ||
        byId.has(scan.scanner)) return fail("INVALID_SCANNER_RESULT");
    for (const finding of scan.findings) {
      if (!plain(finding) || !SEVERITIES.has(finding.severity) ||
          typeof finding.code !== "string" || !/^[A-Z0-9_:-]{1,96}$/.test(finding.code)) {
        return fail("INVALID_SCANNER_FINDING");
      }
    }
    if (scan.status === "clean" && scan.findings.length !== 0) return fail("INCONSISTENT_SCANNER_RESULT");
    if (scan.status === "findings" && scan.findings.length === 0) return fail("INCONSISTENT_SCANNER_RESULT");
    byId.set(scan.scanner, scan);
  }
  const missing = requiredScanners.filter(id => !byId.has(id));
  if (missing.length) return Object.freeze({ ...fail("REQUIRED_SCANNER_MISSING"), missing });
  const unexpected = [...byId.keys()].filter(id => !requiredScanners.includes(id));
  if (unexpected.length) return Object.freeze({ ...fail("UNEXPECTED_SCANNER_RESULT"), unexpected });
  const unavailable = requiredScanners.filter(id => byId.get(id).status === "unavailable");
  if (unavailable.length) return Object.freeze({ ...fail("SCANNER_UNAVAILABLE"), unavailable });
  const findings = requiredScanners.flatMap(id => byId.get(id).findings.map(f => ({ scanner: id, ...f })));
  const critical = findings.filter(f => f.severity === "critical");
  if (critical.length) return Object.freeze({ ...fail("CRITICAL_SECURITY_FINDING"), severity: "reject", findings });
  const blocking = findings.filter(f => f.severity === "high" || f.severity === "medium");
  if (blocking.length) return Object.freeze({ ...fail("SECURITY_FINDINGS_REQUIRE_QUARANTINE"), severity: "quarantine", findings });
  return Object.freeze({
    ok: true, status: "clean", contentSha256: expectedContentSha256,
    scanners: Object.freeze(requiredScanners.map(id => Object.freeze({ scanner: id, version: byId.get(id).version }))),
    findings: Object.freeze(findings)
  });
}

// scanCandidate must be a code-owned adapter to an isolated scanner runner.
// It receives untrusted bytes as data; candidate instructions are never executed here.
export function createSkillSecurityFirewall({
  scanCandidate,
  requiredScanners = REQUIRED_SKILL_SCANNERS
} = {}) {
  if (typeof scanCandidate !== "function") throw new TypeError("TRUSTED_SECURITY_SCAN_ADAPTER_REQUIRED");
  if (!Array.isArray(requiredScanners) || requiredScanners.length < 1 ||
      requiredScanners.some(id => typeof id !== "string" || !SCANNER_ID.test(id)) ||
      new Set(requiredScanners).size !== requiredScanners.length) {
    throw new TypeError("INVALID_REQUIRED_SCANNER_SET");
  }
  async function scan({ candidate, content, files, contentSha256 } = {}) {
    if (!plain(candidate) || typeof content !== "string" || !Array.isArray(files) ||
        !SHA256.test(contentSha256 || "")) return fail("INVALID_SKILL_SCAN_INPUT");
    let report;
    try {
      report = await scanCandidate(Object.freeze({
        candidate: Object.freeze({ ...candidate }),
        content,
        files: Object.freeze([...files]),
        contentSha256,
        executeCandidateCode: false,
        networkAccessForCandidate: false,
        secretAccessForCandidate: false
      }));
    } catch {
      return fail("SECURITY_SCANNER_EXECUTION_FAILED");
    }
    return evaluateSkillSecurityReport(report, { expectedContentSha256: contentSha256, requiredScanners });
  }
  return Object.freeze({ scan });
}
