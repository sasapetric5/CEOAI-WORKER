---
name: client-code-maintenance-estimator
description: Scopes and estimates a client's code maintenance request using explicit evidence, risk categories, and testable acceptance criteria.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Client Code Maintenance Estimator

## Purpose
Help a developer turn a bug-fix or maintenance request into a bounded, transparent service estimate.

## Workflow
1. Collect the reported behavior, expected behavior, reproduction steps, affected environment, and business impact.
2. Separate confirmed facts from hypotheses; request a minimal reproducible example rather than credentials or production access.
3. Classify the request as defect, dependency update, compatibility issue, performance concern, or feature change.
4. Identify likely investigation areas and risks without claiming to have inspected unavailable source code.
5. Define acceptance criteria, regression tests, rollback expectations, and client-supplied verification evidence.
6. Estimate investigation, implementation, testing, review, and handoff effort as ranges with stated assumptions.
7. Identify out-of-scope work and propose a capped diagnostic phase when uncertainty is high.

## Output
Maintenance scope, evidence gaps, risk list, estimate range, acceptance criteria, test plan, exclusions, and handoff checklist.

## Safety and limits
- Do not access production systems, request secrets, or execute untrusted code.
- Do not promise a fixed price or completion date without sufficient evidence.
- No repository writes, deployments, purchases, or client communications.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Scoping and estimation only.
