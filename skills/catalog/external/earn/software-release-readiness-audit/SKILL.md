---
name: software-release-readiness-audit
description: Reviews release evidence, risk, and rollback readiness before a client-approved software release.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Software Release Readiness Audit

## Purpose
Reviews release evidence, risk, and rollback readiness before a client-approved software release.

## Workflow
1. Confirm release scope and target environment.
2. Review versioning, change list, test evidence, unresolved defects, dependency updates, configuration changes, migration needs, observability, support notes, and rollback procedure.
3. Identify missing evidence and high-impact failure modes.
4. Give each finding an owner placeholder and a verifiable acceptance check.
5. Produce a go/no-go recommendation with explicit caveats.

## Output
Release checklist, risk register, evidence gaps, rollback-readiness review, and conditional go/no-go summary.

## Safety and limits
- Do not deploy, approve on behalf of an owner, change production configuration, or claim tests ran without evidence. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
