---
name: adr-review
description: Review Architecture Decision Records for staleness, superseded decisions, missing outcomes, and unlisted alternatives
version: 0.1.0
execution-mode: advisory
argument-hint: "[--scope all|ADR_ID] [--check staleness|outcomes|alternatives]"
category: backend-infra
status: candidate
---
# ADR Review

Audit Architecture Decision Records for quality, currency, and completeness. Checks whether decisions are stale (context has changed), superseded without being marked, missing outcome documentation, or lacking alternative analysis. Helps keep the decision log reliable and actionable.

## When to Use
- Periodic review of architectural decisions for staleness
- Before making a new decision in an area with existing ADRs
- When onboarding someone who needs to understand past decisions
- After a major refactor to check if ADRs still reflect reality

## Execution
1. **Locate ADRs** -- scan for decision records in:
   - `docs/decisions/`, `docs/adr/`, `adr/` directories
   - Ledger entries with type `DECISION`
   - Decision log entries from `[decision-log]`
2. **Staleness check** (if `--check staleness` or `all`):
   - Compare decision context against current codebase state
   - Flag ADRs where the described problem no longer exists
   - Flag ADRs where the chosen solution was never implemented
   - Flag ADRs older than 12 months without review
3. **Superseded check** (all scopes):
   - Find ADRs that contradict each other
   - Identify decisions that were effectively reversed by later commits
   - Flag ADRs not marked as superseded when a newer one exists
4. **Outcomes check** (if `--check outcomes` or `all`):
   - Verify each ADR documents the actual outcome (not just the decision)
   - Flag ADRs missing consequences, trade-offs, or follow-up actions
   - Check if predicted risks materialized
5. **Alternatives check** (if `--check alternatives` or `all`):
   - Verify each ADR lists at least 2 alternatives considered
   - Flag decisions made without documented alternatives
   - Check if rejected alternatives have since become more viable
6. **Report** -- produce findings sorted by priority.

## Output Format
```
ADR Review | scope: {all|ADR_ID} | checks: {staleness,outcomes,alternatives}

## Summary
- Total ADRs reviewed: {N}
- Current and valid: {N}
- Needs attention: {N}
- Superseded (unmarked): {N}

## Findings
### {ADR_ID}: {title}
- **Status**: {current|stale|superseded|incomplete}
- **Issue**: {description of the finding}
- **Evidence**: {what indicates this finding}
- **Recommendation**: {action to take}

## ADR Health
| ADR | Date | Status | Staleness | Outcomes | Alternatives |
|-----|------|--------|-----------|----------|--------------|

## Recommendations
1. {prioritized action items}

## No further action needed | {N} ADRs need updates
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Stale ADRs found | `[decision-log]` to create updated decisions |
| Tech debt from old decisions | `[tech-debt]` to quantify remediation effort |
| Patterns in decision-making | `[retrospective]` to reflect on decision quality |
