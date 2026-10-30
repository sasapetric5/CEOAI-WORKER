---
name: codegen-eval
category: dev-tools
description: >
  Evaluate AI-generated code for correctness, style, security, and
  maintainability. Run static analysis, compare against requirements,
  check for hallucinated APIs, and produce a quality scorecard. Use when
  reviewing AI code before merging or evaluating code generation tools.
version: 0.1.0
status: candidate
execution-mode: advisory
argument-hint: "[--file <path>] [--language <lang>] [--requirements <text>] [--strict]"
---

# codegen-eval

Static evaluation of AI-generated code. Produces a quality scorecard
covering correctness, security, style, and maintainability. Does **not**
execute the code — purely static analysis.

## Arguments

| Flag | Required | Description |
|------|----------|-------------|
| `--file <path>` | yes | Path to the AI-generated code file |
| `--language <lang>` | no | Override language detection (python, javascript, typescript, go, rust, java, c, cpp, ruby, bash) |
| `--requirements <text>` | no | Natural-language description of what the code should do |
| `--strict` | no | Any sub-score below 7 triggers "revise" verdict |

## Workflow

### 1. Load and detect

Read the file. Detect language by extension and content sniffing unless
`--language` overrides. Detect framework from imports. Record SLOC.

### 2. Correctness checks

- **Syntax validation** — parse with native parser (`py_compile`, `node
  --check`, `gofmt -e`, `cargo check`, `javac`).
- **Type checking** — run language type checker (`mypy`, `tsc --noEmit`,
  `go vet`, `cargo check`). Record errors with line numbers.
- **Import resolution** — verify every import resolves to a real
  installable package or existing local module.
- **Hallucinated API detection** — see procedure below.

### 3. Security checks

- **OWASP top 10** — injection sinks (SQL, command, LDAP), XSS, path
  traversal, SSRF, insecure deserialization, broken access control.
- **Dangerous functions** — `eval`, `exec`, `os.system`,
  `subprocess.call(shell=True)`, `child_process.exec`, `Function()`,
  `innerHTML`, system calls with unsanitized input.
- **Hardcoded credentials** — high-entropy strings, secret prefixes
  (`AKIA`, `ghp_`, `sk-`, `xoxb-`), API keys, connection strings.

### 4. Style checks

- **Linter** — `ruff`/`flake8` (Python), `eslint` (JS/TS),
  `golangci-lint` (Go), `clippy` (Rust).
- **Complexity** — cyclomatic >10 or cognitive >15 flagged.
- **Naming conventions** — language idioms (snake_case Python,
  camelCase JS, PascalCase Go exports).

### 5. Requirements comparison (if `--requirements` provided)

- Does the code do what was asked?
- Edge cases handled (empty input, null, boundaries, concurrency)?
- Error paths covered (exceptions, timeouts, partial failures)?
- Extraneous features beyond requirements (over-engineering)?

### 6. Quality scorecard

```
=== codegen-eval Scorecard ===
File: <path>
Language: <lang> (framework: <fw or none>)

Correctness:      X/10   (<justification>)
Security:         X/10   (<justification>)
Style:            X/10   (<justification>)
Maintainability:  X/10   (<justification>)
─────────────────────────
Overall:          X/10   (weighted: correctness 0.35, security 0.30,
                          style 0.15, maintainability 0.20)
Verdict: ACCEPT | REVISE | REJECT
Issues: N critical, M warnings, K info
```

**Rubric:** 9-10 production-ready; 7-8 minor issues; 5-6 revision
required; 3-4 likely rewrite; 0-2 broken/dangerous.

**Verdict thresholds:**
- **ACCEPT**: overall >= 7 AND no sub-score below 6 (below 7 if
  `--strict`).
- **REVISE**: overall >= 5 but not ACCEPT.
- **REJECT**: overall < 5 OR critical security issue OR unparseable.

### 7. Issue list

```
[severity] line N: <description>
  → fix: <suggested fix or "manual review required">
```

Severities: `critical`, `warning`, `info`. Critical first, then by line.

## Hallucinated API Detection Procedure

AI generators invent plausible-looking APIs. This catches them.

1. **Extract all API references**: function calls, method calls, class
   instantiations, decorators, config keys on imported modules.
2. **Classify each**:
   - **Stdlib** — verify against language stdlib docs.
   - **Third-party** — verify package exists on registry (PyPI, npm,
     crates.io, pkg.go.dev, Maven Central), then verify the specific
     function/method exists in a recent version.
   - **Framework** — verify against official docs (React, Django,
     Express, Gin, Actix).
   - **Internal** — verify symbol defined in same file or resolvable
     local module.
3. **Verify** (requires internet):
   - Python: `pip index versions <pkg>` or PyPI JSON API.
   - JS/TS: `npm view <pkg>` or unpkg.
   - Go: `pkg.go.dev/<module>`.
   - Rust: `crates.io/api/v1/crates/<name>`.
   - Cross-reference signatures — package may exist but function may
     not, or arity/params/return type may differ.
4. **Flag as hallucinated** if:
   - Package doesn't exist in any registry.
   - Package exists but called function/method not in public API.
   - Function exists but signature matches no documented overload.
   - Import path valid but resolves to nothing.
5. **Record** each as `critical` correctness issue with evidence.

Without internet, skip live verification and note degraded detection —
rely on heuristics (unusual package names, naming convention mismatches,
suspicious parameter patterns).

## Boundaries

- **No code execution** — static analysis only.
- **Does not replace human review** — augments it; scorecard is advisory.
- **Does not evaluate prompt quality** — use `prompt-regression`.
- **Hallucination detection needs internet** — without it, heuristic-only.
- **Developer makes final accept/reject** — no automated merge blocking.
- **Tooling-dependent** — missing linters/type checkers noted and scored
  conservatively, not skipped silently.

## Output

1. Quality scorecard (above).
2. Issue list with line numbers and fixes.
3. One-paragraph summary for PR comments.
4. If `--requirements` provided: coverage table (met / partially met /
   unmet).
