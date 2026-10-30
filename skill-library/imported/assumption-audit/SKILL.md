---
name: assumption-audit
description: Surface hidden assumptions in code, architecture, or decisions — list what must be true for the system to work
version: 0.1.0
execution-mode: advisory
argument-hint: "<target-path-or-decision> [--scope code|arch|decision]"
category: dev-tools
status: candidate
---
# assumption-audit | Hidden Assumption Surfacing

## When to Use
- Before a major refactor or migration to understand what could break
- Reviewing an architecture for unstated dependencies
- Stress-testing a technical decision before committing
- Onboarding to a codebase by understanding its implicit contracts

## Execution

### 1. Parse Arguments
- `$ARGUMENTS`: target path, architecture doc, or decision description
- `--scope code|arch|decision`: audit focus (default: auto-detect)
  - `code`: scan source files for implicit contracts
  - `arch`: analyze architecture docs and diagrams
  - `decision`: analyze a stated decision for hidden premises

### 2. Code Scope — Scan for Implicit Contracts
- **Type**: unchecked casts, unguarded `None`, type narrowing
- **Order**: list ordering, dict insertion order, async completion
- **Concurrency**: no shared state mutation, assumed atomic operations
- **External**: API availability, file paths, env vars, network reachability
- **Data**: input format, range, encoding, locale
- Record: location, assumption text, and failure consequence

### 3. Architecture Scope — Analyze Design
- Read architecture docs, ADRs, and system diagrams
- Identify assumptions about scalability, reliability, security, performance, operations
- Rate each: explicit (documented) vs implicit (unstated)

### 4. Decision Scope — Analyze Premises
- Parse decision text for stated and unstated premises
- For each, ask: "What if this is false?"
- Identify assumptions about future conditions, technology, constraints, trade-offs

### 5. Risk-Rank and Mitigate
- Score each: **Likelihood** (1-5) × **Impact** (1-5) = risk score
- Sort descending; flag impact-5 assumptions as critical
- For high-risk: suggest **validation** (test), **guard** (assertion), **fallback**, **documentation**

## Output Format

```
assumption-audit | <target>

## Scope: <code|arch|decision>

## Summary
- Assumptions found: 18 | Implicit: 12 | Explicit: 6
- Critical (impact 5): 3 | High risk: 7

## Top Assumptions by Risk
| # | Assumption                              | L | I | Risk | Scope |
|---|-----------------------------------------|---|---|------|-------|
| 1 | Single-region deployment is sufficient  | 3 | 5 | 15   | arch  |
| 2 | Input JSON is always valid UTF-8        | 3 | 4 | 12   | code  |
| 3 | Redis will never lose data              | 2 | 5 | 10   | arch  |

## Detailed Findings
- **Single-region sufficient** (implicit, architecture.md): if false, no failover plan; validate geo-distribution, add cross-region replication
- **Input JSON valid UTF-8** (implicit, api/handler.py:34): if false, UnicodeDecodeError; fuzz test, add encoding check with 400

## Verdict
CRITICAL_ASSUMPTIONS_FOUND / MODERATE_RISK / LOW_RISK / CLEAN
```

## Skill Chains
- After audit -> `[absence-audit]` to check for missing components
- After audit -> `[uncertainty-map]` to quantify uncertainty in findings
- Before committing to a plan -> `[pre-mortem]` to imagine failure scenarios
