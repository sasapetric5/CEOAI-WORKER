---
name: website-security-configuration-review
description: Plans a non-invasive review of public website security headers and configuration evidence for a client remediation report.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Website Security Configuration Review

## Purpose
Define a defensive, non-invasive service for reviewing publicly observable security configuration.

## Workflow
1. Confirm client authorization and define exact hostnames and review boundaries.
2. Collect only normal public HTTP response metadata and published security policy information.
3. Review observed headers such as Content-Security-Policy, HSTS, frame protections, content-type protections, and referrer policy.
4. Compare observations with current authoritative browser and security guidance; record date and scope.
5. Identify configuration gaps and compatibility trade-offs without attempting exploitation.
6. Separate verified observations from inferred risks and environment-dependent recommendations.
7. Prepare remediation guidance and a client-controlled retest checklist.

## Output
Scope statement, observed-header inventory, evidence log, risk-ranked findings, recommendations, and retest plan.

## Safety and limits
- No vulnerability exploitation, port scanning, credential testing, fuzzing, or stress testing.
- Do not access private endpoints or bypass controls.
- No production changes or claims of complete security.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Defensive review planning only.
