---
name: ai-policy-review
description: Review and grade an existing internal AI use policy against NIST AI RMF, ISO 42001, and EU AI Act requirements. Produces gap list, grade, and rewrite recommendations. Saves to _internal/compliance/. Powered by compliance-advisor agent.
version: 1.0.0
execution-mode: advisory
argument-hint: "\"COMPANY\" [--policy-text \"...\"] [--framework nist|iso42001|eu-ai-act|all] [--output grade|full|rewrite]"
category: governance-compliance
status: tested
providers:
  required: [bash, python]
---
# AI Policy Review

Review an internal AI use policy (or acceptable use policy) against leading governance frameworks. Produces a letter grade, gap list, and targeted rewrite recommendations.

## When to Use

- Before publishing or updating an AI use policy
- When a board, legal, or compliance team asks "is our AI policy adequate?"
- During an audit or vendor due diligence process
- When a regulator requests evidence of AI governance
- After a framework update (e.g., new NIST AI RMF guidance published)

## Required Inputs

| Field | Example |
|-------|---------|
| Company name | ACME Corp |
| Policy document | [Paste full text, or upload] |
| Frameworks to grade against | NIST AI RMF + ISO 42001 + EU AI Act |
| Industry context | Financial services / Healthcare / Federal / Commercial |
| Policy type | Acceptable use / Procurement / Development / Deployment |
| Intended audience | All employees / AI development teams / Executives only |

## Policy Review Format

```
AI POLICY REVIEW
Company:   [Name]
Policy:    [Title + version/date if known]
Date:      [Review date]
Reviewer:  compliance-advisor (HUMMBL AI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OVERALL GRADE: [A / B / C / D / F]
[One sentence: what the grade means for this organization's risk posture]

GRADE BREAKDOWN
| Framework | Coverage | Grade | Key gap |
|-----------|----------|-------|---------|
| NIST AI RMF | [%] | [A-F] | [Biggest missing element] |
| ISO 42001 | [%] | [A-F] | [Biggest missing element] |
| EU AI Act | [%] | [A-F] | [Biggest missing element] |
| OWASP LLM Top 10 | [%] | [A-F] | [Biggest missing element] |

────────────────────────────────────────────────────────
WHAT THE POLICY DOES WELL
✓ [Strength 1 — specific clause reference if possible]
✓ [Strength 2]
✓ [Strength 3]

────────────────────────────────────────────────────────
CRITICAL GAPS (policy is non-compliant or silent on these)

GAP-01: [Gap name]
  Missing:     [What the policy doesn't address]
  Required by: [Framework + clause reference]
  Risk:        [What happens without this clause]
  Recommended: [Specific language to add — or "See rewrite section"]

GAP-02: [Gap name]
  Missing:     [...]
  Required by: [...]
  Risk:        [...]
  Recommended: [...]

[Continue for all critical gaps...]

────────────────────────────────────────────────────────
REQUIRED CLAUSES CHECKLIST

Core governance:
  [ ] AI system inventory and classification requirement
  [ ] Designated AI risk owner / accountability structure
  [ ] AI risk tolerance statement
  [ ] Mandatory risk assessment before deployment

Data and privacy:
  [ ] Personal data use in AI training / inference restrictions
  [ ] Data minimization principle for AI inputs
  [ ] Cross-border data transfer restrictions (if applicable)
  [ ] Prohibited data types (biometric, health, etc.)

Transparency and explainability:
  [ ] Disclosure requirement to affected individuals
  [ ] Right to explanation for automated decisions
  [ ] Prohibited use cases (explicit)

Human oversight:
  [ ] Human-in-the-loop requirements for high-risk decisions
  [ ] Escalation path when AI output is questionable
  [ ] Override and appeal mechanism

Security:
  [ ] AI system access controls
  [ ] Prompt injection / adversarial input reference
  [ ] Vendor/third-party AI security requirements

Monitoring and incident response:
  [ ] Ongoing monitoring requirement
  [ ] AI incident definition and reporting requirement
  [ ] Policy review cadence (recommend annual)

────────────────────────────────────────────────────────
LANGUAGE ISSUES (problematic phrasing found)
[Issue 1]: "[Exact quote from policy]"
  Problem:    [Why this language is inadequate or risky]
  Suggested:  "[Better phrasing]"

────────────────────────────────────────────────────────
REWRITE RECOMMENDATIONS (top 3 priority)
1. [Section to rewrite + rationale + suggested new language]
2. [Section to rewrite]
3. [Section to add — currently missing entirely]

────────────────────────────────────────────────────────
IMPLEMENTATION NOTES
[Practical observations about whether this policy is enforceable as written —
e.g., "Policy requires quarterly AI inventory but no owner is designated for
maintaining the inventory. Unenforced requirements create audit exposure."]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AI GOVERNANCE RECEIPT
Document type:  AI Policy Review
Company:        [Name]
Generated:      [Date]
Agent:          compliance-advisor (<model>)
Frameworks:     NIST AI RMF, ISO 42001, EU AI Act, OWASP LLM Top 10
Attestation:    DRAFT — requires qualified legal/compliance review before policy adoption
Estimated human equivalent: $800-2,000 (AI counsel + compliance officer, 4-8 hrs)
Time saved:     4-8 hours
Confidence:     High (if full policy text provided) — Medium (if summary only)
⚠ Not legal advice. Do not adopt revised policy language without legal review.
```

## Grading Rubric

| Grade | Meaning | Action |
|-------|---------|--------|
| A | Comprehensive, framework-aligned, enforceable | Publish; review annually |
| B | Strong foundation, 2-3 material gaps | Fix gaps before next audit |
| C | Adequate for basic compliance, material gaps | Rewrite priority sections within 90 days |
| D | Incomplete, significant regulatory exposure | Suspend publishing; full rewrite required |
| F | Does not exist or is non-substantive | Create from scratch immediately |

## Human Cost Equivalent

- Quick policy scan (gap list only): $400-800
- Full policy review with grade: $800-1,500
- Full review + rewrite of critical sections: $1,500-3,000

## Skill Chains

- `[ai-policy-review]` → `[policy-draft]` (rewrite the failing sections)
- `[ai-policy-review]` → `[ai-risk-assessment]` (policy is the governance layer; system assessment is the technical layer)
- `[ai-policy-review]` → `[governance-report]` (include grade in board summary)
- `[ai-policy-review]` → `[gap-analysis]` (expand gap analysis across full framework)
- For a new policy → `[policy-draft]` first, then `[ai-policy-review]` to grade it
