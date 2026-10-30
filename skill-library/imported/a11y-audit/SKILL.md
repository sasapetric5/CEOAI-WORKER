---
name: a11y-audit
description: Web accessibility audit against WCAG 2.1 AA standards
version: 0.1.0
execution-mode: advisory
argument-hint: "<url_or_file> [--level A|AA|AAA] [--format summary|detailed]"
category: dev-tools
status: candidate
---
# Accessibility Audit

Web accessibility audit against WCAG 2.1 AA: contrast ratios, alt text, ARIA roles, keyboard navigation, and focus management. Scans HTML/JSX/TSX source or live pages to identify barriers for users with disabilities.

## When to Use
- Before shipping a frontend feature or page
- After a UI redesign or component library update
- When accessibility has been flagged as a concern
- As part of a pre-launch quality checklist

## Execution
1. Parse `$ARGUMENTS` for target (required), `--level` (default: `AA`), and `--format` (default: `summary`)
2. If target is a file path: read and analyze the HTML/JSX/TSX source
3. If target is a URL: fetch and analyze the rendered markup
4. Check WCAG criteria by category:
   - **Perceivable**: images missing alt text, color contrast ratios (4.5:1 text, 3:1 large), text alternatives for media
   - **Operable**: keyboard-only navigation paths, focus indicators, skip links, no keyboard traps
   - **Understandable**: form labels, error identification, consistent navigation
   - **Robust**: valid ARIA roles/attributes, semantic HTML, proper heading hierarchy
5. Score each category: PASS / WARN / FAIL with specific element references
6. If `--format detailed`: include code snippets and WCAG success criterion references
7. Prioritize findings: critical (blocks access) > major (significant barrier) > minor (best practice)

## Output Format
```
A11y Audit | {target} | WCAG 2.1 {level}

Overall: {PASS|WARN|FAIL}
- Perceivable: {status} ({N} issues)
- Operable: {status} ({N} issues)
- Understandable: {status} ({N} issues)
- Robust: {status} ({N} issues)

Critical Issues:
1. [{criterion}] {description} -- {element} -- {fix}

Major Issues:
1. [{criterion}] {description} -- {element} -- {fix}

Minor Issues:
1. [{criterion}] {description} -- {element} -- {fix}

Next action: {recommendation}
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Issues found | `[a11y-fix]` to generate patches |
| After building frontend | `[ui-audit]` for visual quality |
| Before this audit | `[frontend]` to review component structure |
