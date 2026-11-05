---
name: api-contract-test-designer
description: Creates a contract-testing plan for API clients and services using explicit schemas, compatibility cases, and synthetic test data.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# API Contract Test Designer

## Purpose
Produce a practical test specification that catches breaking API changes before client delivery.

## Workflow
1. Collect the published API schema, version, consumer expectations, and supported compatibility window.
2. Identify required and optional fields, types, enums, formats, nullability, and documented error responses.
3. Define positive, negative, boundary, malformed, and backward-compatibility cases.
4. Include pagination, rate-limit, authentication failure, timeout, and partial-response scenarios where applicable.
5. Use synthetic fixtures only; remove secrets and personal data from examples and logs.
6. Define provider/consumer contract ownership, version pinning, and change-review expectations.
7. Map each test to a requirement and specify what evidence constitutes a pass; do not claim execution.

## Output
Contract coverage matrix, synthetic fixture plan, compatibility checklist, negative-case suite, and CI integration recommendations.

## Safety and limits
- No production calls, secret handling, or live customer data.
- Do not invent schema guarantees absent from official documentation.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Test design only.
