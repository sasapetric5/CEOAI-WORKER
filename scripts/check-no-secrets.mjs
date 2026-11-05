import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const TEXT_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".json", ".toml", ".yaml", ".yml", ".md", ".txt"]);
const TOKEN_PATTERNS = [
  { rule: "PRIVATE_KEY_HEADER", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { rule: "PROVIDER_TOKEN", pattern: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|(?:sk|rk)_live_[A-Za-z0-9]{16,})\b/ },
];
const ASSIGNMENT_PATTERN = /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret|auth[_-]?token)\b["']?\s*[:=]\s*["']([A-Za-z0-9_./+=-]{32,})["']/ig;
const PLACEHOLDERS = /^(?:change[_-]?me|replace[_-]?me|your[_-].*|example.*|placeholder.*|process\.env.*|env\..*|test[-_].*)$/i;

export function findCredentialFindings(content) {
  const findings = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const entry of TOKEN_PATTERNS) {
      entry.pattern.lastIndex = 0;
      if (entry.pattern.test(line)) findings.push({ line: index + 1, rule: entry.rule });
    }
    ASSIGNMENT_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(ASSIGNMENT_PATTERN)) {
      if (!PLACEHOLDERS.test(match[1])) findings.push({ line: index + 1, rule: "HARDCODED_CREDENTIAL_ASSIGNMENT" });
    }
  }
  return findings;
}

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
for (const file of files) {
  if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase()) || file.startsWith("test/") || file === "scripts/check-no-secrets.mjs") continue;
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  for (const finding of findCredentialFindings(content)) {
    findings.push(file + ":" + finding.line + " " + finding.rule);
  }
}

// Scan all available Git history without ever printing matched source lines or credential values.
// CI checks out full history; local shallow clones scan only the history they possess.
const HISTORY_PATTERNS = [
  "-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|sk-(proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|(sk|rk)_live_[A-Za-z0-9]{16,}",
  "(api[_-]?key|access[_-]?token|client[_-]?secret|password|secret|auth[_-]?token)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9_./+=-]{32,}[\"']",
];
const historicalPaths = new Set();
for (const pattern of HISTORY_PATTERNS) {
  try {
    const output = execFileSync("git", ["log", "--all", "--format=", "--name-only", "-G", pattern, "--", ".", ":(exclude)test/**", ":(exclude)scripts/check-no-secrets.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 });
    for (const file of output.split("\n").map(value => value.trim()).filter(Boolean)) historicalPaths.add(file);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
}
for (const file of historicalPaths) findings.push(file + " historical credential-pattern match (value withheld)");

if (findings.length) {
  process.stderr.write("Potential committed credentials detected (values withheld):\n" + [...new Set(findings)].join("\n") + "\n");
  process.exitCode = 1;
} else {
  process.stdout.write("Repository Shield passed: tracked text and available Git history contain no detected credentials.\n");
}
