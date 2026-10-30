---
name: claim-verify
description: Extract all factual claims from text, verify against web sources, produce verdict table with citations. [Maps to IN6.]
version: 0.2.0
status: stable
canonical_status: not_yet_global_canon
execution-mode: advisory
argument-hint: "[--text \"...\"] [--file <path>] [--mode web-only|stack|deep|extract-only] [--risk-threshold high|medium|low] [--allow-private-lookup]"
category: governance-compliance
providers:
  required: [bash, python]
---
# Claim Verify

> **Status: TESTED** — Promoted from candidate on 2026-06-24 after passing all 10 promotion gates.
> Eval suite v0.2.0: 11 cases, 92 claims, 10/10 gates PASS, 0 privacy leaks, 0 false support, 0 false contradiction.
> Canonical status: HOLD until cross-agent/live-session regression. Next target: STABLE.

Extract every distinct factual claim from a body of text, classify by type and volatility, run parallel web searches against public high-risk claims, and adjudicate each with a typed verdict and citation. Use after any LLM-generated answer that makes factual assertions, before publishing research, or when you suspect factual drift.

## When to Use

- After generating an answer with factual claims (self-audit mode)
- When user says "verify", "validate claims", "fact-check", "did you check that"
- Before publishing blog posts, reports, case studies, or research
- When user suspects model hallucination or factual drift
- After any answer where you said "I answered from training knowledge"

## Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--text "..."` | (self-audit) | External text to verify instead of last answer |
| `--file <path>` | (none) | Read text from a file instead of last answer |
| `--mode` | `web-only` | `web-only`: parallel web searches. `stack`: also query Cognitive Ledger. `deep`: 2+ sources per high-risk claim. `extract-only`: extract + classify only, no verification |
| `--risk-threshold` | `high` | Which claims to verify. `high`: dates/quotes/numbers/names. `medium`: + causal claims. `low`: every claim |
| `--allow-private-lookup` | (off) | Explicitly authorize web search for private/internal claims. Without this flag, private claims are marked NOT_CHECKED_PRIVACY_RESTRICTED |

## Privacy Gate

**Before any web search, classify each claim as public or restricted.**

Restricted claims include:
- Private business plans, strategy, or financials
- Client or customer information
- Personal health, identity, or relationship details
- Internal repo names, unreleased product info
- Legal/trademark claims under NDA or privilege
- Private collaborator details
- Any claim the user has not authorized for external lookup

**Default behavior:**
- Public claim → live web verification allowed
- Restricted claim → mark `NOT_CHECKED_PRIVACY_RESTRICTED`; use provided/internal sources only if available
- Restricted claim + `--allow-private-lookup` → web verification allowed (user explicitly authorized)

This gate is non-negotiable. Web search is not safe verification for private claims.

## Execution

### 0. Source-Check (Pre-Step — Operator Attribution Verification)

**When the operator provides a source attribution** (e.g., "JAMA says X", "per
Beasley 2015", "the CDC reports Y"), run this pre-step BEFORE extracting and
verifying claims. This catches misattributions before they propagate into the
claim verification pipeline.

**Steps:**
1. **Extract the claimed source**: Parse the operator's statement for source
   names (journal names, author names, organization names, publication titles).
2. **Web search**: Search for the claim + the claimed source name. Also search
   for the claim alone (without the source constraint) to find the actual
   primary source.
3. **Compare**: Check whether the top search results attribute the claim to
   the same source the operator cited.
4. **Return verdict**:

| Verdict | Meaning | Action |
|---------|---------|--------|
| `CONFIRMED` | Search results attribute the claim to the operator's cited source | Proceed with normal claim verification |
| `MISATTRIBUTED` | Search results attribute the claim to a DIFFERENT source | Flag the claim, record the correct source, proceed with verification using the correct source |
| `UNABLE_TO_VERIFY` | No clear source attribution found in search results | Flag the claim, proceed with verification but note the attribution is unconfirmed |

5. **Record in ledger**: The source-check result is recorded in the receipt
   header under `source_check` with the original attribution, verification
   result, and corrected source (if applicable).

**Example — JAMA misattribution case:**
- Operator says: "JAMA statistics show that X reduces Y by 30%"
- Source-check searches: "JAMA X reduces Y 30%" and "X reduces Y 30% statistics"
- Search results attribute the statistic to JACC (Journal of the American
  College of Cardiology), not JAMA
- Verdict: `MISATTRIBUTED` — correct source is JACC
- The claim proceeds to verification with the corrected source (JACC)

**Integration with receipt**: Add to the receipt header:
```
| source_check | {not_applicable | confirmed | misattributed | unable_to_verify} |
| original_attribution | {operator's cited source, if any} |
| corrected_attribution | {correct source if misattributed, else N/A} |
```

### 1. Extract Claims (Atomic)
Parse input text into a numbered list of **atomic** factual claims. A "claim" is any assertion that could be true or false. Split compound claims into separate atoms before verification.

Bad: "OpenAI released X, it is cheaper than Y, and enterprises are adopting it rapidly."
Good: Three claims — (1) OpenAI released X. (2) X is cheaper than Y. (3) Enterprises are adopting X rapidly.

Group by category (provenance, core claim, propositions, criticisms, etc.).

### 2. Classify Claims
Tag each claim with type and volatility:

**Claim type:**
`factual` `technical` `legal` `medical` `financial` `scientific` `biographical` `current-event` `historical` `strategic` `normative` `interpretive` `private/internal`

**Temporal volatility:**
| Tag | Meaning | Example |
|-----|---------|---------|
| `stable` | Unlikely to change | "Python tuples are immutable" |
| `slow-changing` | Changes over years | "Python 3.11 is the latest stable release" |
| `volatile/current` | Changes over months/weeks | "OpenAI's current pricing is..." |
| `historical` | Fixed in the past | "The 1890 census used Hollerith tabulators" |
| `prediction` | Forward-looking | "Kurzweil predicts AGI by 2029" |
| `private/internal` | Not publicly verifiable | "Reuben wants to adopt X as doctrine" |

### 3. Risk-Flag
Tag each claim with a risk level for factual drift:
- **HIGH**: specific dates, verbatim quotes, exact numbers, proper nouns, quantitative comparisons, chart/graph characterizations
- **MEDIUM**: causal claims, attributions, paraphrased positions
- **LOW**: general framing, widely established facts

Only verify claims at or above `--risk-threshold`.

### 4. Privacy Gate
Apply the privacy gate (see above). Split claims into:
- **Public, verifiable** → proceed to search
- **Restricted, not checked** → mark `NOT_CHECKED_PRIVACY_RESTRICTED`
- **Restricted, user-authorized** → proceed to search (only with `--allow-private-lookup`)

### 5. Search (Parallel)
Batch web searches for public high-risk claims. Issue 4-8 searches in parallel, grouping related claims into combined queries where possible. In `--deep` mode, run 2+ independent searches per high-risk claim from different angles.

In `--stack` mode, first query the Cognitive Ledger and local corpus (`/ask-the-stack`) before web searches.

**Structured API sources (use before web search when claim type matches):**

| Claim type | API | Command |
|------------|-----|---------|
| Scientific/academic | OpenAlex (250M works, CC0) | `python ~/bin/free_apis.py openalex search "<claim keywords>" --limit 10` |
| Biomedical/medical | PubMed E-utilities | `python ~/bin/free_apis.py pubmed search "<claim keywords>" --limit 10` |
| US regulatory/legal | Federal Register | `python ~/bin/free_apis.py fedreg search "<claim keywords>" --limit 10` |
| Vulnerability/security | NVD CVE | `python ~/bin/free_apis.py nvd search --keyword "<CVE ID or keyword>" --limit 10` |
| Vulnerability/security | OSV.dev | `python ~/bin/free_apis.py osv query --package <pkg> --ecosystem <ecosystem>` |
| Entity/relationship | Wikidata SPARQL | `python ~/bin/free_apis.py wikidata search "<entity name>" --limit 5` |

These return structured, authoritative data without web scraping. Prefer them over web search for scientific, medical, regulatory, and security claims. For scientific claims, OpenAlex provides citation counts and DOIs for primary source verification.

**Source hierarchy (prefer higher):**
1. Official/primary source (documentation, standards body, direct statement)
2. Primary data or direct documentation
3. **Structured API sources** (OpenAlex, PubMed, Federal Register, NVD, OSV, Wikidata)
4. Reputable secondary source (established journal, major publication)
5. Multiple independent secondary sources
6. Community/social source — weak signal only
7. Model output is **never** evidence unless the claim is about model output

For legal/medical/financial/public-safety claims: route to `REQUIRES_EXPERT_REVIEW` if sources are insufficient. Do not overstate confidence.

### 6. Adjudicate
For each claim, compare against evidence and assign a verdict:

| Verdict | Meaning |
|---------|---------|
| `SUPPORTED` | Confirmed by sources; claim is accurate |
| `PARTIALLY_SUPPORTED` | Directionally correct but imprecise — wrong date, overstated comparison, reversed framing |
| `CONTRADICTED` | Source material says the opposite |
| `UNVERIFIABLE` | No sources found to confirm or deny |
| `OUT_OF_SCOPE` | Claim is not factual (opinion, normative, interpretive) — not verifiable by design |
| `REQUIRES_EXPERT_REVIEW` | Legal/medical/financial/safety claim with insufficient sources — do not adjudicate without domain expertise |
| `NOT_CHECKED_PRIVACY_RESTRICTED` | Claim is private/internal and user did not authorize external lookup |
| `STALE_OR_TIME_SENSITIVE` | Claim was true at some point but may have changed — needs re-verification |

**Materiality (not a verdict):** `BELOW_THRESHOLD` is a materiality status, not a verdict. It indicates a claim is too low-risk or well-established to warrant verification. When a claim is below threshold, the agent may skip verification — but if it does verify, the verdict should be one of the 8 canonical verdicts above, not `BELOW_THRESHOLD`. In the eval suite, `BELOW_THRESHOLD` is a ground-truth annotation indicating the claim should not be penalized for missing verification.

### 7. Report
Produce the verdict table (see Output Format), receipt header, summary counts, and a clear separation of hard errors vs. imprecisions.

## Output Format

```
Claim Verify | <source: self-audit | external text | file>
══════════════════════════════════════════════════

## Receipt

| Field | Value |
|-------|-------|
| skill | claim-verify |
| version | 0.2.0 |
| mode | {extract_only | verify_public | verify_with_sources | advisory} |
| input_scope | {user_supplied_text | source_doc | public_claims | mixed} |
| tool_access | {web_available | web_unavailable | internal_sources_only} |
| privacy_gate | {passed | restricted | user_authorized_external_lookup} |
| source_check | {not_applicable | confirmed | misattributed | unable_to_verify} |
| original_attribution | {operator's cited source, if any} |
| corrected_attribution | {correct source if misattributed, else N/A} |
| claims_checked | {N} |
| claims_not_checked | {N} |
| source_policy | {official_first | primary_first | reputable_secondary_allowed} |
| unresolved_uncertainty | {list of claim #s} |

## Claims Extracted: {N}
## Risk-Flagged: {N} ({N} high, {N} medium, {N} low)

## Verdict Table

| # | Claim (abbreviated) | Type | Volatility | Verdict | Evidence |
|---|---------------------|------|------------|---------|----------|
| 1 | {claim text} | factual | stable | SUPPORTED | {source citation} |
| 2 | {claim text} | factual | historical | PARTIALLY_SUPPORTED | {what's wrong} |
| 3 | {claim text} | financial | volatile | REQUIRES_EXPERT_REVIEW | {insufficient sources} |
| 4 | {claim text} | private/internal | private/internal | NOT_CHECKED_PRIVACY_RESTRICTED | — |

## Summary

| Verdict | Count | Claim #s |
|---------|-------|----------|
| SUPPORTED | {N} | {list} |
| PARTIALLY_SUPPORTED | {N} | {list} |
| CONTRADICTED | {N} | {list} |
| UNVERIFIABLE | {N} | {list} |
| OUT_OF_SCOPE | {N} | {list} |
| REQUIRES_EXPERT_REVIEW | {N} | {list} |
| NOT_CHECKED_PRIVACY_RESTRICTED | {N} | {list} |
| STALE_OR_TIME_SENSITIVE | {N} | {list} |

## Hard Errors (CONTRADICTED)
- {claim #}: {what's wrong, what the source says}

## Imprecisions (PARTIALLY_SUPPORTED)
- {claim #}: {what's imprecise, how to fix}

## Assumptions
- Web sources assumed accurate as of {date}
- Source policy: {official_first | primary_first | ...}
- Search queries: {N} issued, {N} returned usable evidence
- Privacy gate: {N} claims restricted, {N} user-authorized
- Unresolved: {N} claims could not be verified
```

## Base120 Context

- Primary: **IN6** (Proof by Contradiction — search for evidence that contradicts the claim)
- Related: **IN5** (Absence Audit — surfaces what's wrong or missing), **IN8** (Proof by Contrapositive — if claim were false, what would we find?)

## Skill Chains
- For independent verification inference -> `[reasoning-router]` (`python ~/bin/reasoning_router.py route`)

### Advisory

- After `/claim-verify` with CONTRADICTED claims → `/content-review` (fix before publishing)
- After `/claim-verify` with UNVERIFIABLE claims → `/web-research` (deeper search)
- After `/claim-verify` with REQUIRES_EXPERT_REVIEW → escalate to operator or domain expert
- After `/claim-verify` on research output → `/research-ingest` (only ingest SUPPORTED claims)
- Before `/claim-verify` → `/hallucination-check` (if source docs available, run that first)

## Authority

**Extraction/classification mode** (`--mode extract-only`): Any agent tier may run. Produces claim list + type/volatility/risk tags only. No web access needed.

**Full verification mode** (default): Requires web search tools. Agents without current-source tools must mark claims `UNVERIFIABLE` or `SOURCE_REQUIRED` — they must not pretend verification occurred.

| Tier | Extract-only | Full verification |
|------|-------------|-------------------|
| T1 (TRUSTED) | May run | May run |
| T2 (Active/High) | May run | May run |
| T3 (Medium) | May run | May run (notify operator) |
| T4 (Probationary) | May run | May run with operator approval |
| Operator | Override any restriction | Override any restriction |

## Companion

See `PLAYBOOK.md` in this skill directory for the full workflow reference, including the canonical test case (Kurzweil session: 37 claims, 3 errors, 5 imprecisions).

## Promotion Receipt

```yaml
skill: claim-verify
skill_version: v0.2.0
status: stable
canonical_status: not_yet_global_canon
promotion_date: 2026-06-24
previous_status: tested
eval_suite_version: v0.2.0
eval_cases: 11
eval_claims: 92
promotion_gates: 10/10 PASS
verdict_accuracy: 92.9%
false_support_rate: 0.0%
false_contradiction_rate: 0.0%
privacy_gate_accuracy: 100%
privacy_leaks: 0
expert_review_recall: 100%
out_of_scope_recall: 100%
unverifiable_recall: 100%
extraction_recall: 84.8%
extraction_precision: 84.8%
schema_validity: 100%
baseline: eval/baselines/scored_20260624T042800Z.json
report: eval/results/eval_report.md
residual_risks:
  - compound claim atomization below ideal (84.8% extraction recall)
  - BELOW_THRESHOLD should remain materiality metadata, not verdict enum
  - current-events fixtures require freshness revalidation
next_status_target: stable
next_gate: cross-agent or live-session regression
```

### Ground Truth Corrections

```yaml
ground_truth_correction:
  case: case_008
  field: CNCF donation date
  original_ground_truth: "2014, SUPPORTED"
  corrected_ground_truth: "2015, CONTRADICTED"
  discovered_by: claim-verify real eval (agent correctly identified 2015)
  date: 2026-06-24
  implication: eval process improves corpus quality bidirectionally
```
