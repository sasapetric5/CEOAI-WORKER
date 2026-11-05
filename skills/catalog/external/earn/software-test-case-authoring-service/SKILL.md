---
name: software-test-case-authoring-service
description: Converts software requirements and user journeys into traceable manual and automated test cases with boundary and regression coverage.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Software Test Case Authoring Service

## Purpose
Create a test-design deliverable for a client team that needs repeatable quality checks.

## Workflow
1. Collect approved requirements, acceptance criteria, user journeys, and supported environments.
2. Map each requirement to one or more observable test conditions.
3. Write preconditions, steps, test data, expected results, and cleanup notes.
4. Add positive, negative, boundary, permission, error, and regression scenarios.
5. Prioritize by user impact, failure likelihood, and business criticality.
6. Identify cases suitable for automation and those requiring human judgment.
7. Review traceability and ambiguity; do not claim tests were executed unless execution evidence is supplied.

## Output
Traceability matrix, test case suite, risk-based priorities, test data plan, and execution evidence template.

## Safety and limits
- Use synthetic data and client-approved requirements.
- Do not execute untrusted code or access production environments.
- Never fabricate pass/fail results.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Test design and documentation only.
