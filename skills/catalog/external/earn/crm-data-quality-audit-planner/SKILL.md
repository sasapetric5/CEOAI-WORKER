---
name: crm-data-quality-audit-planner
description: Scopes a CRM data-quality audit covering duplicates, field consistency, lifecycle states, provenance, and safe correction proposals.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# CRM Data Quality Audit Planner

## Purpose
Plan a client-facing CRM cleanup report without accessing or modifying a live CRM.

## Workflow
1. Confirm authorization and request a minimized, synthetic, or properly de-identified export.
2. Inventory fields, object relationships, allowed values, source systems, and ownership.
3. Define duplicate candidate rules using stable identifiers and conservative matching thresholds.
4. Check missing values, invalid formats, inconsistent lifecycle states, stale records, and conflicting sources.
5. Identify personal data and define minimization, retention, and access restrictions before review.
6. Propose reversible corrections with confidence scores and human approval for ambiguous matches.
7. Define backup, sample validation, reconciliation, and rollback requirements for any future client-led import.

## Output
Data dictionary, quality scorecard, duplicate candidates, correction proposal, privacy flags, and controlled remediation plan.

## Safety and limits
- Never collect unnecessary personal data or access a live CRM.
- Do not merge, delete, enrich, or contact records.
- No production writes or automated imports.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Audit planning only.
