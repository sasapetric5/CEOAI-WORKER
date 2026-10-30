---
name: changelog-subscribe
description: Watch upstream dependencies for breaking changes and security advisories
version: 0.1.0
execution-mode: advisory
argument-hint: "[--deps auto|FILE] [--severity breaking|major|all]"
category: dev-tools
status: candidate
---
# Changelog Subscribe

Watch upstream dependencies for breaking changes, new features, and security advisories. Acts as an early warning system for dependency risks before they become upgrade emergencies.

## When to Use
- Periodic check on dependency health (weekly/monthly)
- Before upgrading Python or key dependencies
- After a security advisory notification
- Planning a dependency upgrade sprint

## Execution
1. Parse `$ARGUMENTS` for `--deps` (default: `auto`) and `--severity` (default: `major`)
2. If `--deps auto`: extract dependencies from `pyproject.toml`, `requirements.txt`, or `setup.py`
3. If `--deps FILE`: read dependency list from specified file
4. For each dependency:
   a. Check current installed version vs latest available
   b. Check for security advisories (CVEs, pip-audit results)
   c. Check changelog/release notes for breaking changes
   d. Identify deprecation warnings that affect our usage
5. Filter by severity:
   - **breaking**: only show breaking changes and security issues
   - **major**: breaking + significant new features + deprecations
   - **all**: everything including minor patches
6. Classify each finding:
   - **SECURITY**: CVE or advisory -- immediate action needed
   - **BREAKING**: API change that will break our code
   - **DEPRECATED**: feature we use is being removed
   - **FEATURE**: useful new capability available
   - **PATCH**: bug fix, no action needed
7. For SECURITY and BREAKING items, assess impact on this codebase

## Output Format
```
Changelog Subscribe | {N} deps checked | severity: {severity}

Alerts:
  SECURITY: {count}
  BREAKING: {count}
  DEPRECATED: {count}

{severity_icon} {dep_name} {current} -> {latest}
  {finding_type}: {description}
  Impact: {assessment}
  Action: {recommendation}

Up to Date: {list of deps with no issues}

Next action: {recommendation}
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Python upgrade needed | `[python-upgrade]` for version migration |
| Third-party check | `[dep-check]` for stdlib-only compliance |
| Security issues found | `[security-scan]` for full security review |
| CVE advisory details needed | `[free-apis]` — NVD/OSV for vulnerability data (`python ~/bin/free_apis.py nvd "<cve-id>"` or `python ~/bin/free_apis.py osv "<package>"`) |
