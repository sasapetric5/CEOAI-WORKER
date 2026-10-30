---
name: etl-design
description: Design data pipelines with extraction, validation, transformation, loading, error handling, and idempotency
version: 0.1.0
execution-mode: advisory
argument-hint: "<source> <target> [--transform STEPS] [--schedule CRON]"
category: fleet-ops
status: candidate
---
# ETL Design

Design a complete data pipeline from source to target. Covers extraction strategy, validation rules, transformation steps, load patterns, error handling, retry logic, and idempotency guarantees. Produces a runnable pipeline specification with monitoring hooks.

## When to Use
- Moving data between systems (database, API, file, message bus)
- Designing a recurring data sync or migration pipeline
- Need idempotent, restartable data processing with error handling
- Planning a data warehouse load or analytics pipeline

## Execution
1. **Analyze source** -- inspect the source system:
   - Data format (JSON, CSV, SQL, API response)
   - Volume and velocity estimates
   - Access pattern (pull, push, stream)
   - Schema or sample data
2. **Analyze target** -- inspect the target system:
   - Expected schema and constraints
   - Write pattern (upsert, append, replace)
   - Capacity and rate limits
3. **Design extraction** -- define how data is pulled:
   - Incremental vs. full extract
   - Watermark/cursor strategy for incremental
   - Error handling for source unavailability
4. **Design transformation** -- for each `--transform` step:
   - Input validation rules
   - Type conversions and mappings
   - Filtering, deduplication, enrichment
   - Data quality checks (nulls, ranges, referential integrity)
5. **Design loading** -- define write strategy:
   - Idempotency mechanism (natural key, hash, transaction ID)
   - Batch size and commit frequency
   - Conflict resolution (skip, overwrite, merge)
6. **Error handling** -- define failure modes:
   - Dead letter queue for bad records
   - Retry policy with backoff
   - Alerting on failure threshold
7. **Schedule** (if `--schedule`) -- define cron expression and monitoring.
8. **Generate specification** -- produce pipeline spec as executable pseudocode or Python outline.

## Output Format
```
ETL Design | source: {source} | target: {target}

## Pipeline Overview
- Direction: {source} -> {target}
- Pattern: {incremental|full|streaming}
- Schedule: {cron expression|on-demand}
- Idempotency: {mechanism}

## Extract
- Method: {description}
- Watermark: {field and strategy}

## Transform
| Step | Input | Output | Validation |
|------|-------|--------|------------|

## Load
- Strategy: {upsert|append|replace}
- Batch size: {N}
- Conflict resolution: {policy}

## Error Handling
- Dead letter: {location}
- Retry: {policy}
- Alert threshold: {N failures}

## Pipeline Code (outline)
{Python pseudocode or implementation sketch}
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Pipeline designed | `[data-quality]` to define validation rules |
| Schema changes needed | `[schema-migrate]` to handle target schema updates |
| Scheduling required | `[cron-audit]` to verify no schedule conflicts |
