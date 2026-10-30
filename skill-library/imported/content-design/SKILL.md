---
name: content-design
description: Design product microcopy, labels, onboarding text, empty states, error messages, help text, and action copy. Use when words shape user action, comprehension, trust, or recovery.
version: 0.1.0
execution-mode: advisory
argument-hint: <screen-flow-or-copy>
category: fleet-ops
status: candidate
---
# Content Design

## Purpose

Answer: "Do the words help users understand what to do and what happens next?"

## Workflow

1. Identify the user intent, emotional state, and required action.
2. Review labels, headings, CTA copy, help text, empty states, errors, and confirmations.
3. Check clarity, specificity, tone, trust, legal/compliance risk, and accessibility.
4. Rewrite copy as concise alternatives with rationale.
5. Align terms with product taxonomy and user language.

## Output

```markdown
Content Verdict: <clear | serviceable | confusing | risky>
High-Impact Copy Issues:
- <issue -> replacement>
Recommended Copy:
- <location>: <copy>
Terminology Notes:
- <terms>
```

## Rules

- Prefer concrete action language over vague encouragement.
- Error copy must explain what happened, what to do, and whether user work is safe.
- Do not introduce legal, medical, or financial claims without source approval.
