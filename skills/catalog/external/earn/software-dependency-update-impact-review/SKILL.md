---
name: software-dependency-update-impact-review
description: Assesses proposed dependency updates for compatibility, maintenance, and security implications.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Software Dependency Update Impact Review

## Purpose
Assesses proposed dependency updates for compatibility, maintenance, and security implications.

## Workflow
1. Record exact current and target versions from approved manifests and lockfiles.
2. Check official release notes, advisories, support windows, breaking changes, runtime requirements, and transitive dependency effects.
3. Distinguish confirmed advisories from unverified risk.
4. Identify required tests and rollback conditions.
5. Do not recommend an update solely from a version number or popularity signal.

## Output
Dependency impact matrix, evidence links, breaking-change checklist, and staged update test plan.

## Safety and limits
- Do not install packages, alter lockfiles, execute untrusted scripts, or claim a vulnerability is exploitable without evidence. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
