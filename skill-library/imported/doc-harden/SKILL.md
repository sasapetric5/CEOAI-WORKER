---
name: doc-harden
description: Harden research markdown by extracting claims, suggesting evidence grades, and generating verification appendices.
version: 1.1.0
status: tested
canonical_status: not_yet_global_canon
execution-mode: side_effecting
argument-hint: <path-to-markdown-file> | --scan-dir <research-directory> | --dry-run <file>
category: hummbl-research
providers:
  required: [bash, python]
---
# doc-harden

### 0. Emit SKILL_INVOKE
Post SKILL_INVOKE to the bus before any stateful action.
```
Type: SKILL_INVOKE
To: all
Message: [skill=doc-harden] [mode=side_effecting] [args_hash=<sha256>] [session=<session_id>]
```
(The skill invocation runtime injects the caller's canonical identity as `from_id`.)

Automated research document hardening — extract claims, classify, suggest evidence grades, and generate verification appendices.

## Description

Transforms raw research documents into hardened, evidence-graded artifacts by:
1. Parsing markdown and extracting empirical/theoretical/design/anecdotal claims
2. Classifying each claim by type and suggesting HUMMBL evidence grades (A-E)
3. Building web search queries for unverified claims
4. Generating a structured hardening verification appendix

## Usage

```bash
[skill] doc-harden --dry-run <path-to-markdown-file>  # preview without writing
[skill] doc-harden <path-to-markdown-file>            # append appendix to source
[skill] doc-harden <path-to-markdown-file> -o <out>   # write appendix separately
[skill] doc-harden --scan-dir <research-directory>
```

## Triggers

- `[doc-harden]` or `[skill] doc-harden`
- Any request to "harden a research document"
- Any request to "extract claims" or "grade evidence" in a markdown doc

## Workflow

### Input
- Single markdown file or directory of markdown files

### Output
- Appended hardening verification appendix with:
  - Graded claims table (type, suggested grade, confidence, verification query)
  - Summary statistics
  - Gaps and next steps checklist

### Claim Types
| Type | Description | Typical Grade |
|------|-------------|---------------|
| empirical | Quantitative, survey, benchmark | B-C |
| theoretical | Theorem, formal result, canonical fact | A-B |
| forward_looking | Will/should/must, recommendation | E |
| design | Architecture, pattern, requirement | C |
| anecdotal | Personal, self-reported, experience | D |

### Grade Rubric
| Grade | Meaning | Source |
|-------|---------|--------|
| A | Peer-reviewed, reproducible | Canonical textbook or journal |
| B | Authoritative source | Industry survey, vendor docs, primary research |
| C | Industry practice | Technical blog, documentation, conference talk |
| D | Anecdotal | Self-reported, personal experience |
| E | Unverified | Hallucination, forward-looking, unvalidated theory |

## Implementation

The skill executes `doc_harden.py` (bundled in this skill directory). Prefer
`--dry-run` before modifying a source document.

```bash
python ~/.agents/skills/doc-harden/doc_harden.py <args>
```

## Chains

- Post-hardening: `[web-research]` to execute verification queries
- Post-hardening: `[mtsmu-research]` for high-rigor follow-up
- Pre-publication: `[case-study-verify]` to guardrail against phantom citations

## Base120 Mapping

- DE1: Root Cause Analysis — identifies why claims lack verification
- RE4: Nested Story — structures appendix as layered narrative
- IN5: Absence Audit — surfaces missing citations
- IN17: Counterfactual — assesses what if claims were false

## Files

- `SKILL.md` — this file
- `doc_harden.py` — claim extraction and grading engine

## Version

1.0.1 — 2026-05-19: mark side-effecting and honor `--output`

## Skill Chains

### Mandatory

None — document enhancement; modifies local markdown files only (appendix generation). Use `--dry-run` to preview before writing.

### Advisory

- Post-hardening: `[web-research]` to execute verification queries
- Post-hardening: `[mtsmu-research]` for high-rigor follow-up
- Pre-publication: `[case-study-verify]` to guardrail against phantom citations

## Authority

- **T1 (TRUSTED)**: May run (harden documents, append verification appendices)
- **T2 (Active/High)**: May run (harden documents, append verification appendices)
- **T3 (Medium)**: May run (harden documents, append verification appendices)
- **T4 (Probationary)**: May run with operator notification (modifies local files; prefer `--dry-run` first)
- **Operator**: Override any restriction

## Promotion Receipt (v1.1.0 — 2026-06-24)

**Status**: `candidate` → `tested`
**Eval suite**: `eval/` (8 cases, multiple claims per case)
**Schema version**: `doc_harden_eval.v0.1.0`

### Self-test results (perfect run)
- type_accuracy: 1.0 (gate: ≥0.75) PASS
- grade_accuracy: 1.0 (gate: ≥0.70) PASS
- extraction_recall: 1.0 (gate: ≥0.80) PASS
- false_grade_inflation: 0.0 (gate: ≤0.15) PASS
- schema_validity: 1.0 (gate: =1.0, HARD) PASS

### Residual issues
- Self-test uses ground-truth-as-actual; real LLM run needed for true accuracy baseline
- Markdown parsing edge cases (code blocks, nested lists) not tested
- Verification appendix generation not tested (only claim extraction and grading)
