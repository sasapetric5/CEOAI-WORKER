---
name: freelance-api-integration-scope-and-quote
description: Prepares a bounded API integration proposal with explicit dependencies, risks, and effort assumptions.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance API Integration Scope and Quote

## Purpose
Prepares a bounded API integration proposal with explicit dependencies, risks, and effort assumptions.

## Workflow
1. Confirm business outcome, API documentation, supported authentication, endpoints, data direction, rate limits, sandbox availability, and ownership.
2. Map happy path and failure handling including retries, idempotency, timeouts, and observability.
3. Separate unknown vendor behavior from confirmed contract details.
4. Estimate discovery, implementation, tests, documentation, and handoff independently.
5. Define exclusions and change-control triggers.

## Output
Integration architecture outline, endpoint matrix, estimate assumptions, milestone plan, and client questions.

## Safety and limits
- Do not request or store credentials, call production APIs, or promise delivery against unknown vendor constraints. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
