---
name: a11y-fix
description: Generate specific fixes for accessibility audit findings with code patches
version: 0.1.0
execution-mode: remedial
argument-hint: "[--from-audit FINDINGS] [--priority critical|high|all]"
category: dev-tools
status: candidate
---
# Accessibility Fix

Generate specific fixes for accessibility audit findings with priority ranking and code patches. Takes audit results and produces actionable, copy-pasteable code changes that resolve each issue.

## When to Use
- After running `[a11y-audit]` and finding issues
- When handed a list of accessibility violations to resolve
- Remediating a batch of WCAG compliance gaps
- Fixing specific accessibility bugs reported by users

## Execution
1. Parse `$ARGUMENTS` for `--from-audit` (previous audit findings or file) and `--priority` (default: `critical`)
2. If no `--from-audit`: check for recent `[a11y-audit]` output in session context
3. Sort findings by priority: critical > high > medium > low
4. For each finding within the priority filter:
   a. Identify the affected file and element
   b. Generate a minimal code patch (old -> new)
   c. Explain why the fix resolves the WCAG criterion
   d. Note any behavioral changes the fix introduces
5. Group fixes by file to minimize context switches during implementation
6. Flag any fixes that require design decisions (e.g., choosing alt text content, picking focus order)

## Output Format
```
A11y Fix | priority: {priority} | {N} fixes

File: {path}
  Fix 1: [{criterion}] {description}
  - Element: {selector/line}
  - Before: {old code}
  - After: {new code}
  - Why: {explanation}

  Fix 2: [{criterion}] {description}
  ...

Decisions Needed:
- {fix requiring human judgment}: {options}

Summary: {N} auto-fixable, {M} need decisions

Next action: {recommendation}
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Fixes applied | `[commit]` to save changes |
| Came from audit | `[a11y-audit]` was the source |
| Design decisions needed | `[ux-audit]` for broader UX review |
