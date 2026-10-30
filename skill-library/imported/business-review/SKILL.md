---
name: business-review
description: Review an external business using source-traceable evidence, explicit uncertainty, commercial-system analysis, and decision-ready recommendations.
version: 0.1.0
execution-mode: advisory
argument-hint: '<business> [period] [audience] [format]'
triggers:
  - review this business
  - external company business review
  - assess a company business model
chains:
  - artifact-template-business-review
base120:
  - base120-evidence-002
  - base120-structure-005
contracts: [{"id": "br-001", "type": "BEH", "text": "MUST cover all 5 review dimensions: revenue, pipeline, product, operations, and risks -- no dimension may be skipped", "requirement_level": "MUST", "tags": ["dimensions", "completeness", "review"], "machine_check": {"kind": "regex", "spec": {"pattern": "revenue.*pipeline.*product.*operations.*risks|no dimension may be skipped", "target": "SKILL.md"}}, "line_ref": 65}, {"id": "br-002", "type": "CNT", "text": "MUST NOT fabricate metrics -- every number must cite a source (dashboard, report, or system of record)", "requirement_level": "MUST NOT", "tags": ["truthfulness", "metrics", "non-negotiable"], "machine_check": {"kind": "regex", "spec": {"pattern": "fabricate metrics|every number must cite a source", "target": "SKILL.md"}}, "line_ref": 66}, {"id": "br-003", "type": "BEH", "text": "MUST flag metrics trending negative for 2+ consecutive periods -- trends matter more than snapshots", "requirement_level": "MUST", "tags": ["trends", "monitoring", "negative-trend"], "machine_check": {"kind": "regex", "spec": {"pattern": "trending negative.*2.*consecutive|trends matter more than snapshots", "target": "SKILL.md"}}, "line_ref": 67}, {"id": "br-004", "type": "CNT", "text": "MUST NOT report all green when any P0 risk is unresolved -- P0 risks override overall status", "requirement_level": "MUST NOT", "tags": ["p0-risk", "status-override", "non-negotiable"], "machine_check": {"kind": "regex", "spec": {"pattern": "all green when any P0 risk|P0 risks override overall status", "target": "SKILL.md"}}, "line_ref": 68}, {"id": "br-005", "type": "BEH", "text": "MUST produce a 3P update (progress, plan, problems) with owners and deadlines for each action item", "requirement_level": "MUST", "tags": ["3p-update", "action-items", "owners"], "machine_check": {"kind": "regex", "spec": {"pattern": "3P update.*progress.*plan.*problems|owners and deadlines for each action item", "target": "SKILL.md"}}, "line_ref": 69}]
---

# Business Review

Produce a decision-ready assessment of a business without importing HUMMBL-specific assumptions or treating public claims as independently verified facts.

## Workflow

1. Define the business, review period, audience, decision context, `as_of` timestamp, geography, and confidentiality.
2. Establish a source hierarchy before research: audited filings and regulator records; company operating disclosures; product and pricing surfaces; reputable third-party data; then commentary and inference.
3. Build an evidence ledger for every material claim with value, unit, period, capture date, source, scope, freshness, confidence, and whether the value is reported, calculated, estimated, or unknown.
4. Separate capability evidence, reach, demand, payment, retention, customer outcomes, and repeatability. Do not let technical activity or visibility stand in for commercial proof.
5. Review the system from customer and problem through offer, pricing, acquisition, sale, delivery, outcome, retention, economics, operating capacity, risks, and strategic options.
6. Preserve contradictions in a drift register. Prefer the most authoritative current source, but show material unresolved conflicts instead of silently reconciling them.
7. Distinguish historical results, current state, management targets, analyst estimates, hypotheses, and proposed test criteria.
8. Lead with a concise verdict and end with decisions, reversible next steps, owners where known, evidence gates, and explicit continue, revise, or stop conditions.
9. When a presentation is requested, use the retained business-review template mechanics, cite volatile claims, render every slide, and validate factual and visual integrity.

## Constraints

- Do not invent private metrics, customer outcomes, ownership, strategy, pricing, conversion thresholds, or management intent.
- Do not describe management guidance, market sizing, forecasts, or recommendations as historical performance.
- Do not infer demand from repository activity, product availability, employee expertise, media attention, or internal use.
- Do not imply endorsement, inside access, certification, legal clearance, or investment suitability without evidence and authority.
- Do not expose confidential inputs in an external artifact.
- Do not contact the company, transact, publish, or make investment or operating decisions without explicit authorization.

## Examples

**Example 1:** “Review Company X as a potential partner.” Evaluate strategic fit, commercial evidence, delivery risk, and decision gates without inventing non-public economics.

**Example 2:** “Turn this startup review into an investment deck.” Label estimates, preserve missing evidence, and present diligence questions rather than favorable assumptions.

## Evidence

- [ ] Business, period, geography, audience, decision, and `as_of` recorded
- [ ] Source hierarchy, evidence ledger, and drift register included
- [ ] Reported, calculated, estimated, proposed, stale, and unknown values labeled
- [ ] Capability, reach, demand, payment, outcome, retention, and repeatability separated
- [ ] Material claims traceable to scoped sources
- [ ] Recommendations include evidence gates and revision or stop conditions

## Contracts

5 load-bearing contracts declared in frontmatter. Summary:

| ID | Type | Level | What it protects |
|----|------|-------|------------------|
| br-001 | BEH | MUST | MUST cover all 5 review dimensions: revenue, pipeline, produ |
| br-002 | CNT | MUST NOT | MUST NOT fabricate metrics -- every number must cite a sourc |
| br-003 | BEH | MUST | MUST flag metrics trending negative for 2+ consecutive perio |
| br-004 | CNT | MUST NOT | MUST NOT report all green when any P0 risk is unresolved --  |
| br-005 | BEH | MUST | MUST produce a 3P update (progress, plan, problems) with own |

All 5 are machine-checked via regex against this SKILL.md -- drift detection fires if the load-bearing prose is removed.
