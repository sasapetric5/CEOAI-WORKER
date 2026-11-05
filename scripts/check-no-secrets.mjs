import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const TEXT_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".json", ".toml", ".yaml", ".yml", ".md", ".txt"]);
const TOKEN_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|(?:sk|rk)_live_[A-Za-z0-9]{16,})\b/,
];
const ASSIGNMENT_PATTERN = /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret|auth[_-]?token)\b["']?\s*[:=]\s*["']([A-Za-z0-9_./+=-]{32,})["']/ig;
const PLACEHOLDERS = /^(?:change[_-]?me|replace[_-]?me|your[_-].*|example.*|placeholder.*|process\.env.*|env\..*|test[-_].*)$/i;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
for (const file of files) {
  if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (TOKEN_PATTERNS.some(pattern => pattern.test(line))) {
      findings.push(file + ":" + (index + 1) + " high-confidence credential pattern");
    }
    ASSIGNMENT_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(ASSIGNMENT_PATTERN)) {
      if (!PLACEHOLDERS.test(match[1])) {
        findings.push(file + ":" + (index + 1) + " hardcoded credential assignment");
      }
    }
  }
}
if (findings.length) {
  process.stderr.write("Potential committed secrets detected:\n" + findings.join("\n") + "\n");
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed: no high-confidence credentials in tracked text files.\n");
}
