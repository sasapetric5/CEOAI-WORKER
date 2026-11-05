---
name: database-schema-review-service
description: Reviews a client-approved database schema for integrity, maintainability, and migration risks.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Database Schema Review Service

## Purpose
Reviews a client-approved database schema for integrity, maintainability, and migration risks.

## Workflow
1. Confirm database type, version, schema scope, and intended workload.
2. Review only approved schema exports with sensitive values removed.
3. Examine keys, constraints, relationships, nullability, naming, indexes, data types, and migration compatibility.
4. Identify integrity risks and query patterns that need measurement.
5. Separate static observations from performance claims that require workload evidence.
6. Propose reversible, staged improvements and validation queries.

## Output
Schema findings, relationship map, integrity-risk register, index and type recommendations, and migration validation checklist.

## Safety and limits
- Do not connect to production databases, inspect live records, run migrations, or claim performance gains without measurements. No credentials or personal data. No runtime activation or tool grants.
- Research, drafting, and planning only; execution requires a separate future approval and reviewed integration.

## Provenance
CEOAI-authored workflow. Intake candidate only.
