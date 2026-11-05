---
name: api-integration-failure-triage-service
description: Turns client-approved API error evidence into a reproducible diagnosis and bounded remediation plan.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# API Integration Failure Triage Service

## Purpose
Turns client-approved API error evidence into a reproducible diagnosis and bounded remediation plan.

## Workflow
1. Confirm the authorized endpoint, environment, expected behavior, and redacted evidence.
2. Reproduce only with synthetic or explicitly approved non-production requests.
3. Classify authentication, schema, rate-limit, timeout, network, and upstream failures.
4. Trace request/response shape without retaining secrets or personal data.
5. Separate confirmed causes from hypotheses.
6. Produce a minimal remediation plan and regression cases.

## Output
Redacted incident timeline, failure classification, reproduction steps, root-cause confidence, remediation checklist, and regression tests.

## Safety and limits
- Never probe third-party systems without authorization. Do not expose tokens, credentials, personal data, or production payloads. Do not modify systems or retry costly operations. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
