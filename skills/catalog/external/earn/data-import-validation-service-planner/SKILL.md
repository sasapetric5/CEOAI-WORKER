---
name: data-import-validation-service-planner
description: Plans reliable validation for client-authorized CSV, JSON, and spreadsheet imports.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Data Import Validation Service Planner

## Purpose
Plans reliable validation for client-authorized CSV, JSON, and spreadsheet imports.

## Workflow
1. Define source and target schemas, required fields, types, allowed values, identifiers, encoding, date and currency conventions, and duplicate rules.
2. Design preflight checks, row-level error reporting, reject/quarantine behavior, reconciliation totals, and rollback strategy.
3. Use synthetic examples or minimized client-approved samples.
4. Specify acceptance thresholds before import.

## Output
Import mapping, validation rules, sample error report, reconciliation checklist, and rollback plan.

## Safety and limits
- Do not ingest or transfer data to external services. Minimize personal data and use synthetic samples where possible. Do not execute imports or overwrite records. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
