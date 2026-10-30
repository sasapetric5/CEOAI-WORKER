---
name: doc-self-check
description: Pre-publish self-check for research docs — contradiction scan, pip-show verification, ledger validate. Run before publishing any doc with quantitative claims, package characterizations, or chain-status assertions.
version: 0.1.0
status: candidate
canonical_status: not_yet_global_canon
execution-mode: advisory
argument-hint: "[--file <path>] [--skip pip|validate|contradiction]"
---
# doc-self-check | Pre-Publish Research Doc Self-Check

> **Origin**: 2026-09-14 memory-infrastructure-deep-review AAR. 4 adversarial peer reviewers found 13 material errors that self-review missed — including a self-contradictory entry-type claim, a false "BROKEN" ledger claim, and a "stub" characterization that `pip show` would have refuted. This skill encodes the 3 checks that would have caught the most material errors before publication.

## When to Use

- Before publishing any research doc with quantitative claims (counts, percentages, ratios)
- Before publishing any doc that characterizes installed packages ("X is a stub", "X is not installed", "X has N modules")
- Before publishing any doc that reports ledger chain status, hash chain integrity, or validation results
- After peer review corrections are applied (re-run to confirm no new contradictions introduced)

## Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--file <path>` | (required) | Path to the research doc to check |
| `--skip` | (none) | Comma-separated list of checks to skip: `pip`, `validate`, `contradiction` |

## Checks

### 1. Contradiction scan (Rec 1 from AAR)

**Goal**: Catch self-contradictions where one section's claim contradicts another's.

**Process**:
1. Extract every quantitative claim from the doc: lines containing `\d+` (numbers), `%`, ratios (`N of M`), counts (`N entries`, `N errors`), and status words (`BROKEN`, `VALID`, `MISSING`, `NOT IMPLEMENTED`, `stub`).
2. Group claims by topic (ledger paths, package names, doctrine files, entry types, agent counts, etc.).
3. For each group, check: does any claim in section A contradict a claim in section B?
4. Common contradiction patterns to flag:
   - "The enum rejects type X" vs "the ledger contains type X entries"
   - "X is a stub" vs "X has N modules" (where N > 0)
   - "X does not exist anywhere" vs any reference to X existing
   - "N% PROPOSAL" vs a table that classifies the denominator differently
   - "chain never recovers" vs "valid entries exist at lines > break point"
5. Report each potential contradiction with both line numbers and both quotes.

**Output**: `CONTRADICTION: <section A claim> (line N) vs <section B claim> (line M)`

### 2. pip-show verification (Rec 2 from AAR)

**Goal**: Verify any claim about an installed package's contents.

**Process**:
1. Grep the doc for package characterization patterns: `is a stub`, `is not installed`, `does not exist as an importable module`, `has N modules`, `is a stub package`, `is gutted`.
2. For each package named in those claims, run `pip show <package>` and `pip list --format=columns | grep <package>`.
3. Compare the doc's claim to the pip output:
   - If doc says "stub" but pip shows many modules → FLAG
   - If doc says "not installed" but pip shows it installed → FLAG
   - If doc says "N modules" but pip shows different count → FLAG
4. Also check: is there a source tree that differs from the installed version? Note version skew if `pip show` version differs from the tree's `pyproject.toml` version.

**Output**: `PIP_MISMATCH: doc says "<claim>" but pip show <pkg> says <reality>`

### 3. Ledger validate (Rec 4 from AAR)

**Goal**: Verify chain-status claims by running validate directly.

**Process**:
1. Grep the doc for ledger paths (lines containing `ledger.jsonl`, `_state/cognition/`).
2. Grep for chain-status claims: `BROKEN`, `valid`, `chain mismatch`, `N errors`, `N valid`.
3. For each ledger path mentioned, run `python -m hummbl_cognition validate --ledger <path>` (or the appropriate validate command).
4. Compare the doc's claims to the validate output:
   - If doc says "BROKEN" but validate says "all OK" → FLAG
   - If doc says "N valid" but validate shows different count → FLAG
   - If doc says "never recovers" but validate shows valid entries after the break → FLAG
   - If doc says "N errors" but validate shows different count → FLAG
5. Also check: does the doc distinguish between "valid" (passes validation) and "chain-validated" (has `previous_hash` set and passes chain check)? If not, flag as misleading.

**Output**: `VALIDATE_MISMATCH: doc says "<claim>" but validate says <reality>`

## Execution

Run all 3 checks in sequence. For each flag found, report:
- The check that found it
- The doc line number
- The doc claim
- The verified reality
- A suggested correction

If no flags: `PASS — no self-contradictions, pip mismatches, or validate mismatches found.`

If flags found: do NOT auto-fix. Report all flags and let the author decide corrections. Re-run after corrections to confirm.

## What this skill does NOT do

- Does not check factual claims against external sources (use `claim-verify` for that)
- Does not check doctrine/code alignment (use manual review or `agent-audit`)
- Does not replace peer review (run peer review after this skill passes)
- Does not check prose quality, framing, or prioritization (use editorial review)

## Origin receipts

- AAR: 2026-09-14 memory-infrastructure-deep-review (4 adversarial peer reviewers)
- Most material error caught: entry-type conflation (claimed 45% / 5 of 11; actual 91% / 10 of 11) — self-contradictory because the doc's own section 2 reported entries that section 8 claimed the enum rejected
- False claim caught: "Ledger A BROKEN after entry 1" — validate returns "9 entries, all OK"
- Mischaracterization caught: "hummbl_governance is a stub" — pip show reveals ~50 modules
