---
name: no-code-automation-migration-planner
description: Plans migration of a no-code business workflow by comparing portability, data export, replacement options, and operational risk.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# No-Code Automation Migration Planner

## Purpose
Help a freelancer scope migration away from a fragile, costly, or unsuitable no-code workflow.

## Workflow
1. Document the current workflow, triggers, actions, owners, dependencies, and failure handling.
2. Inventory platform plans, usage limits, export formats, API availability, retention, and cancellation terms from official documentation.
3. Identify vendor lock-in, proprietary expressions, hidden schedules, credentials, and data dependencies without collecting secrets.
4. Compare candidate replacements on required capabilities, total operating cost, portability, security, and maintenance burden.
5. Plan data export and transformation using a non-production sample.
6. Define parallel-run checks, reconciliation, cutover approval, rollback, and decommissioning criteria.
7. Provide an effort range and flag any migration step requiring paid tiers or external side effects.

## Output
Current-state map, dependency inventory, portability assessment, option comparison, migration stages, risk register, and rollback plan.

## Safety and limits
- Do not log in, cancel services, export live data, or modify integrations.
- Verify prices and limits from official current documentation; mark unknowns explicitly.
- Never request passwords, tokens, or customer datasets.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Migration assessment only.
