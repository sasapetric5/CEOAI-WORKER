---
name: bki-cite-audit
description: Audit the BKI corpus bibliography — verify each citation exists, check claim-source match, flag phantoms. Prerequisite for peer review and LinkedIn publishing.
version: 0.1.0
execution-mode: advisory
argument-hint: "[citation|all|unverified]"
category: cognitive
status: candidate
---
# BKI Citation Audit

Audit the BKI bibliography for citation integrity. Every empirical claim in the BKI corpus must survive external scrutiny before it appears in LinkedIn articles, HUMMBL pitch materials, or any academic-adjacent publication.

## Usage

```
[bki-cite-audit]                  # audit all citations (default)
[bki-cite-audit] "Walton"         # audit a specific author or keyword
[bki-cite-audit] unverified       # re-run only citations currently flagged UNVERIFIED
[bki-cite-audit] all              # explicit full audit, same as default
```

## Corpus Location

The primary BKI source is the agent definition, which contains all four
propositions, the Broccolilly Equation, the Fitness Profile, and
theoretical allies:

```
~/.agents/agents/bki.md
```

If the five-file BKI corpus exists at `$HOME/PROJECTS/arcana/bki_docs_for_claude_ai/`,
read those instead (they are more detailed). As of 2026-09-02, the corpus
files do not exist on disk, in git history, or in Trash — the agent
definition is the source of truth.

Bibliography cross-references live in:
```
$HOME/PROJECTS/hummbl-bibliography/mappings/bki_evidence.json
```

Audit report is written to:
```
$HOME/PROJECTS/arcana/bki_citation_audit.md
```

## Pre-Seeded Citation Register

These are the citations most critical to verify. They carry load-bearing empirical claims used in HUMMBL pitches and client-facing BKI materials.

**Bibliography status** (updated 2026-09-02): entries marked `[IN BIB]` are
present in `hummbl-bibliography`; entries marked `[NOT IN BIB]` are known
gaps. See `mappings/bki_evidence.json` for full cross-references.

| # | Citation | Claimed Finding | Proposition | Priority | Bib status |
|---|----------|----------------|-------------|----------|------------|
| 1 | Walton & Cohen | "+0.3 SD academic achievement in high-belonging environments; effect is larger for populations experiencing systemic exclusion" | Cognitive Scaffolding (P1) | HIGH | [IN BIB] `Walton2011BelongingUncertainty` (T2) |
| 2 | Edmondson | "+35% complex problem-solving performance when psychological safety is present; teams with higher safety report more errors AND have better outcomes" | Cognitive Scaffolding (P1) | HIGH | [IN BIB] `Edmondson1999PsychologicalSafety` (T10) |
| 3 | Google Project Aristotle | Psychological safety as the top predictor of team effectiveness across 180+ teams studied | Cognitive Scaffolding (P1) | HIGH | [IN BIB] `GoogleProjectAristotle2015` (T10) |
| 4 | Bourdieu — habitus | "Practical sense cannot be acquired through instruction; it forms only through genuine participation in a community where you belong" | Embodied Knowing (P3) | MEDIUM | [IN BIB] `Bourdieu1977OutlineTheory` (T2) |
| 5 | Bourdieu — symbolic capital | Cultural capital from one field does not transfer without belonging infrastructure mediating the transfer | Symbolic Systems (P4) | MEDIUM | [IN BIB] `Bourdieu1977OutlineTheory` (T2) |
| 6 | Habermas — ideal speech situation | Non-coerced, symmetrical discourse is structurally a high-belonging environment | Relational Validation (P2) | MEDIUM | [IN BIB] `Habermas1981CommunicativeAction` (T2) |
| 7 | Bateson — Learning II/III | Learning to learn (L-II) and identity transformation (L-III) cannot occur in threat states | Cognitive Scaffolding (P1) | MEDIUM | [NOT IN BIB] — add `Bateson1972EcologyOfMind` |
| 8 | Fanon — *Wretched of the Earth* / *Black Skin, White Masks* | Colonial environments as structurally low-belonging; psychiatric syndromes as Fitness Profile in threat lockdown | Theoretical Ally | LOW | [NOT IN BIB] — low priority |
| 9 | Thaler & Sunstein (behavioral economics) | Context is empirically the strongest predictor of behavior — stronger than stated values or training completion | Broccolilly Equation (C variable) | MEDIUM | [NOT IN BIB] — add `ThalerSunstein2008Nudge` |
| 10 | Cialdini | Social environment and belonging relationship are stronger determinants of behavior than training record | Broccolilly Equation (C variable) | MEDIUM | [NOT IN BIB] — add `Cialdini2007Influence` |
| 11 | Broccolilly Equation (S×T×I×C×D=R) | [INTERNAL — no external citation needed; mark status as INTERNAL] | Original construct | N/A | N/A |
| 12 | Fitness Profile (6 modes) | [INTERNAL — original construct by Reuben; not externally validated beyond author] | Original construct | N/A | N/A |
| 13 | Lieberman — social neuroscience | Social pain activates same circuits as physical pain; belonging is a primary need | Cognitive Scaffolding (P1) | HIGH | [IN BIB] `Lieberman2013Social` (T8) |
| 14 | Polanyi — tacit knowledge | "We can know more than we can tell"; tacit dimension is enabling condition for explicit knowledge | Embodied Knowing (P3) | MEDIUM | [IN BIB] `Polanyi1966TacitDimension` (T2) |
| 15 | Dreyfus — skill acquisition | Expert performance is intuitive pattern recognition, not rule-following | Embodied Knowing (P3) | MEDIUM | [IN BIB] `Dreyfus1986MindOverMachine` (T2) |
| 16 | Vygotsky — ZPD | Higher mental functions originate in social interaction; cultural tools acquired through participation | Symbolic Systems (P4) | MEDIUM | [IN BIB] `Vygotsky1978MindSociety` (T8) |
| 17 | Porges — polyvagal theory | Three-tier autonomic nervous system; neuroception determines cognitive accessibility | Biocognitive OS | HIGH | [IN BIB] `Porges2011PolyvagalTheory` (T8) |
| 18 | Csikszentmihalyi — flow | Flow requires suppression of self-consciousness; low belonging amplifies self-consciousness | Biocognitive OS | MEDIUM | [IN BIB] `Csikszentmihalyi1990Flow` (T1) |
| 19 | Ajzen — theory of planned behavior | Subjective norms (social context) construct intention; context is strongest predictor | Broccolilly Equation (C variable) | MEDIUM | [IN BIB] `Ajzen1991TheoryPlannedBehavior` (T2) |

## Audit Process

### Step 1 — Extract Citations from Corpus

Read the BKI agent definition and extract every citation, named researcher,
named study, and empirical claim. Add any not already in the pre-seeded
register above.

Read in order:
1. `~/.agents/agents/bki.md` — primary source (all propositions, Broccolilly
   Equation, Fitness Profile, theoretical allies)
2. `$HOME/PROJECTS/hummbl-bibliography/mappings/bki_evidence.json` —
   bibliography cross-references (PRESENT vs MISSING status per proposition)

If the five-file corpus at `$HOME/PROJECTS/arcana/bki_docs_for_claude_ai/`
exists, read those instead of (or in addition to) the agent definition.

For each citation found, record:
- Author(s) and year if present
- Exact claimed finding or statistic (verbatim from source)
- Which BKI proposition it supports
- Whether a DOI, journal name, or title is given
- Whether the citation is PRESENT in the bibliography (check bki_evidence.json)

### Step 2 — Verify Each Citation

For each citation requiring external verification (not marked INTERNAL), call:

```
mcp__claude_ai_Scholar_Gateway__semanticSearch
```

Query strategy:
- For quantitative claims (e.g., "+0.3 SD"): search for the study by author + topic + approximate year. Try multiple queries if the first returns no results.
- For theoretical works (Bourdieu, Habermas, Bateson, Fanon): search for the specific book or paper title. These are well-indexed — a miss likely means the specific claim is a misreading.
- For Google Project Aristotle: this is a Google internal study (2016), not peer-reviewed. Search for the published documentation or re:Work summary. Expected status: APPROXIMATE at best (internal study, limited methodological disclosure).
- For behavioral economics (Thaler, Sunstein, Cialdini): search for *Nudge* (Thaler & Sunstein) or *Influence* (Cialdini) — these are books, not journal articles. Verify the specific claim against the book's documented findings.

For each Scholar search result:
- Record the title, authors, year, and publication venue returned
- Check whether the specific statistic or claim cited in BKI matches what the source actually reports
- Note any discrepancy between BKI's characterization and the source content

### Step 3 — Grade Each Citation

Assign one of four grades:

| Grade | Definition |
|-------|-----------|
| **VERIFIED** | Source found via Scholar search; claimed finding matches source content within reasonable paraphrase tolerance |
| **APPROXIMATE** | Source found; claim is directionally supported but specific statistic or framing is not confirmed (e.g., effect size differs, or finding is from a different study by the same author) |
| **UNVERIFIED** | Source not found in Scholar search results; or source found but the specific claim does not appear in it |
| **PHANTOM** | Source found but the claimed finding is directly contradicted by the source, or the cited statistic demonstrably belongs to a different study than attributed |

Special grades:
- **INTERNAL** — original construct (Broccolilly Equation, Fitness Profile). No external citation needed. Do not penalize.
- **THEORETICAL** — canonical philosophical work (Bourdieu, Habermas, Bateson, Fanon). Claim is an interpretive application, not a direct empirical finding. Lower verification bar: confirm the author/work exists and the cited concept is present in their body of work.

### Step 4 — Write Audit Report

Write the audit report to:
```
$HOME/PROJECTS/arcana/bki_citation_audit.md
```

Use this format:

```markdown
# BKI Citation Audit
**Date**: YYYY-MM-DD
**Auditor**: claude-code (bki-cite-audit)
**Corpus version**: BKI_01_THEORY_MASTER.md v1.0
**Scope**: [all | filtered by $ARGUMENTS]

## Summary

| Grade | Count |
|-------|-------|
| VERIFIED | N |
| APPROXIMATE | N |
| UNVERIFIED | N |
| PHANTOM | N |
| INTERNAL | N |
| THEORETICAL | N |
| **Total** | N |

## Publication Readiness

- LinkedIn article: [READY / NOT READY — reason]
- HUMMBL pitch deck: [READY / NOT READY — reason]
- Academic submission: [READY / NOT READY — reason]

## Citation Detail

| # | Citation | Claimed Finding | Grade | Confidence | Source Found | Notes / Action |
|---|----------|----------------|-------|-----------|-------------|----------------|
| 1 | Walton & Cohen | +0.3 SD academic achievement | ... | ... | ... | ... |
...

## Findings Requiring Action

### Must Fix Before Any External Publication
[List PHANTOM citations with specific remediation: remove, replace with correct source, or reframe as claim]

### Should Verify Before Academic Submission
[List UNVERIFIED citations with suggested search strategies]

### Acceptable for Pitch Decks (but flag if audited)
[List APPROXIMATE citations with the specific discrepancy noted]

### No Action Needed
[List VERIFIED, INTERNAL, and THEORETICAL citations]
```

## Grading Criteria — Worked Examples

**Walton & Cohen "+0.3 SD"**: Search Scholar for "Walton Cohen belonging uncertainty achievement". If the 2011 *Science* paper (Walton & Cohen, "A Brief Social-Belonging Intervention Improves Academic and Health Outcomes of Minority Students") is returned and the effect size in the abstract or results section is approximately 0.3 SD for GPA outcomes — grade VERIFIED. If the paper is found but the effect size is not 0.3 SD, or is conditional on demographics not mentioned in BKI — grade APPROXIMATE with a note.

**Edmondson "+35%"**: The "+35% complex problem-solving" figure is specific. Search for Edmondson psychological safety team performance. Verify whether this exact figure appears in a published Edmondson study. If it does not appear verbatim — grade APPROXIMATE and note the actual finding. Do not leave it as VERIFIED with an unconfirmed statistic. This number is used in HUMMBL pitches and will be scrutinized.

**Google Project Aristotle**: This is a 2016 internal Google study documented on re:Work (rework.withgoogle.com). It is not peer-reviewed. Grade as APPROXIMATE maximum unless a peer-reviewed paper confirming the finding is located. Note the source type explicitly in the audit report.

## Constraints

- DO NOT fabricate Scholar search results. If a search returns no results, report UNVERIFIED — do not invent a plausible-sounding paper.
- DO NOT upgrade a citation grade without evidence. APPROXIMATE is not VERIFIED.
- DO NOT downgrade INTERNAL or THEORETICAL citations — they are not claiming external empirical support.
- Mark every grade claim with the Scholar query used, so the audit is reproducible.
- If Scholar Gateway is unavailable, mark all external citations as UNVERIFIED (tool failure) and note the outage. Do not skip the report.

## Downstream Use

| Grade | LinkedIn article | HUMMBL pitch | Academic paper |
|-------|-----------------|-------------|---------------|
| VERIFIED | Yes | Yes | Yes |
| APPROXIMATE | Yes (with hedge) | Yes (with hedge) | No — verify first |
| UNVERIFIED | No | No | No |
| PHANTOM | No — remove | No — remove | No — remove |
| INTERNAL | N/A (mark as original) | Yes | Yes (clearly labeled) |
| THEORETICAL | Yes | Yes | Yes (with interpretation note) |

PHANTOM citations must be removed before any external publication. "Remove" means: either drop the claim entirely, find the correct source, or reframe the claim as the author's original synthesis rather than an external empirical finding.

## Related

- BKI agent definition: `~/.agents/agents/bki.md` (primary corpus)
- BKI bibliography mapping: `$HOME/PROJECTS/hummbl-bibliography/mappings/bki_evidence.json`
- Theoretical foundations rule: `~/.agents/rules/theoretical-foundations.md`
- Preprint scan skill: `[preprint-scan]` (use before ingesting arXiv/SSRN sources into the BKI ledger)
- Evidence grade skill: `[evidence-grade]` (complementary — grades source quality, this skill grades claim-source match)
- Free APIs: `[free-apis]` — OpenAlex as citation verification fallback when Scholar Gateway is unavailable (`python ~/bin/free_apis.py openalex "<author-or-title>"`)
