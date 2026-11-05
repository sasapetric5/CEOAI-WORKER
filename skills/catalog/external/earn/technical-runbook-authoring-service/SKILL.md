---
name: technical-runbook-authoring-service
description: Creates operational runbooks from verified system documentation and owner-approved procedures.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Technical Runbook Authoring Service

## Purpose
Creates operational runbooks from verified system documentation and owner-approved procedures.

## Workflow
1. Confirm service boundaries, audience, escalation roles, and supported environments.
2. Gather approved architecture, monitoring signals, dependencies, and known failure modes.
3. Write symptom-to-check decision paths with safe read-only diagnostics first.
4. Mark commands that require elevated approval and include expected output, stop conditions, rollback, and escalation criteria.
5. Validate every procedure with a system owner before operational use.

## Output
Service overview, alert response steps, diagnostic decision tree, escalation matrix, and owner-validation checklist.

## Safety and limits
- Never invent commands or imply they were executed. Do not include secrets or destructive steps as default actions. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
