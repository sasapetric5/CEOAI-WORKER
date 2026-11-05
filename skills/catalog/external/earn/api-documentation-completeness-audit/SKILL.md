---
name: api-documentation-completeness-audit
description: Checks API documentation for developer usability, accuracy, and coverage against an approved contract.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# API Documentation Completeness Audit

## Purpose
Checks API documentation for developer usability, accuracy, and coverage against an approved contract.

## Workflow
1. Confirm API version and authoritative OpenAPI or contract source.
2. Compare endpoint coverage, authentication description, parameters, schemas, examples, error responses, pagination, rate limits, idempotency, versioning, and deprecation guidance.
3. Test examples only with synthetic data or an approved sandbox.
4. Mark contradictions and undocumented behavior for owner confirmation.
5. Prioritize gaps by integration impact.

## Output
Endpoint coverage matrix, documentation defects, example improvements, and prioritized update backlog.

## Safety and limits
- Do not expose credentials, call production endpoints, or invent undocumented behavior. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
