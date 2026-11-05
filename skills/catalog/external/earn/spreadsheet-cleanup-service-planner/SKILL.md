---
name: spreadsheet-cleanup-service-planner
description: Plans a safe, clearly scoped spreadsheet cleanup or reporting service using user-authorized sample data and explicit quality checks.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Spreadsheet Cleanup Service Planner

## Purpose
Help a freelancer define and deliver spreadsheet cleanup, normalization, validation, and reporting work without exposing client data or silently changing source records.

## Workflow
1. Collect the client's requested outcome, file format, row/column scale, source systems, and allowed handling rules.
2. Ask for a synthetic or minimized sample first; identify personal, financial, health, credential, or commercially sensitive columns that should be removed or masked.
3. Define the source-of-truth copy, backup/rollback method, allowed transformations, and fields that must never be changed.
4. Specify checks for duplicate rows, inconsistent date/number formats, whitespace, missing values, invalid categories, formula errors, and referential mismatches as relevant.
5. Separate reversible formatting changes from semantic corrections that require client confirmation.
6. Define validation totals and before/after comparisons so changes are auditable.
7. Estimate effort based on a representative sample and known complexity; mark unknowns and avoid claiming a full-file estimate from an unrepresentative sample.
8. Prepare a scoped offer, acceptance checklist, and handoff notes. Keep original data unchanged until the client approves the transformation plan.

## Output
Service scope, data minimization checklist, transformation rules, QA matrix, effort assumptions, acceptance criteria, rollback plan, and client-facing offer draft.

## Safety and limits
- Process only user-authorized files; do not send client data to external services.
- Never request passwords, credentials, payment data, or unnecessary sensitive personal data.
- Do not alter source files or connect to client databases as part of planning.
- No outreach, publishing, paid APIs, or marketplace actions.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Planning and draft-only.
