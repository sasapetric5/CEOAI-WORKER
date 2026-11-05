---
name: freelance-backup-restore-readiness-review
description: Plans a client-facing review of backup coverage, restore evidence, recovery objectives, and operational gaps.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance Backup & Restore Readiness Review

## Purpose
Defines a bounded paid assessment of backup and recovery readiness for a website, application, or small business system. It focuses on recoverability evidence rather than general maintenance or infrastructure changes.

## Workflow
1. Confirm system ownership, approved scope, data classification, and permitted evidence sources.
2. Inventory critical systems, data stores, backup locations, schedules, retention, encryption claims, and responsible owners from supplied documentation.
3. Record business-defined recovery time and recovery point objectives; mark missing targets as unresolved rather than inventing them.
4. Review the most recent restore-test evidence, backup age, coverage gaps, dependency order, and documented failure scenarios.
5. Identify single points of failure, access-control concerns, retention conflicts, and recovery steps that lack an accountable owner.
6. Build a prioritized remediation and tabletop-test plan with measurable acceptance criteria.

## Output
Backup coverage matrix, recovery objective register, evidence gaps, risk-ranked recommendations, and restore-test checklist.

## Safety and limits
- Do not access production systems, copy backups, request secrets, initiate restores, delete data, or change retention settings.
- No runtime activation or tool grants. Review of client-supplied documentation and planning only; hands-on testing requires separate written authorization and safeguards.
- Never claim a backup is recoverable without a successful, evidenced restore test.

## Provenance
CEOAI-authored workflow. Intake candidate only.
