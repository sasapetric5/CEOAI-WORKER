---
name: webhook-integration-validator
description: Reviews a proposed webhook integration for signature verification, replay resistance, delivery retries, idempotency, and safe event processing.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Webhook Integration Validator

## Purpose
Help a freelancer assess whether a webhook design is robust before implementation or client handoff.

## Workflow
1. Identify the event producer, receiver, event types, expected volume, and delivery guarantees documented by the provider.
2. Verify official signature format, timestamp tolerance, secret rotation, and canonicalization requirements.
3. Require signature verification before trusting event content; reject unsigned or invalid payloads.
4. Define replay protection, idempotency keys, duplicate delivery handling, and event ordering assumptions.
5. Specify fast acknowledgement, asynchronous processing, bounded retries, dead-letter handling, and manual recovery.
6. Review payload minimization, sensitive fields, retention, logging redaction, and access controls.
7. Build a test matrix for valid, invalid, stale, duplicated, malformed, oversized, and out-of-order events.

## Output
Webhook threat checklist, event lifecycle, verification requirements, retry and idempotency design, privacy review, and test matrix.

## Safety and limits
- Never expose webhook secrets or request live signing keys.
- Do not register endpoints, send test events, or alter production configuration.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Design review only.
