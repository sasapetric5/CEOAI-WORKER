---
name: data-quality
description: Validate data completeness, consistency, freshness, and schema conformance
version: 0.1.0
execution-mode: advisory
argument-hint: "<file> [--schema SCHEMA] [--checks completeness|consistency|freshness|all]"
category: data-science
status: candidate
---
# Data Quality

Validate a data file across four dimensions: completeness (missing values, null rates), consistency (format uniformity, referential integrity), freshness (staleness of timestamps), and schema conformance (against a provided or inferred schema).

## When to Use
- Before ingesting data into a pipeline or database
- After an ETL job to verify output quality
- When investigating data-related bugs or unexpected behavior
- As a periodic health check on critical data files

## Execution
1. Parse `$ARGUMENTS` for file path, optional schema, and check types
2. Load the data file (CSV, JSON, JSONL, TSV)
3. **Completeness**: Calculate null rate per field, identify required fields with gaps, flag >5% null rate
4. **Consistency**: Check type uniformity per column, detect mixed types, validate format patterns (emails, dates, UUIDs)
5. **Freshness**: Find timestamp fields, compute age of newest and oldest records, flag if newest >24h old
6. **Schema**: If `--schema` provided, validate every record against schema; otherwise infer schema and report deviations
7. Score each dimension 0-100 and compute overall quality score
8. Present findings sorted by severity

## Output Format
```
Data Quality | <filename>

## Score: <overall>/100
| Dimension | Score | Issues |
|-----------|-------|--------|
| Completeness | <N>/100 | <count> fields with >5% nulls |
| Consistency | <N>/100 | <count> type mismatches |
| Freshness | <N>/100 | Newest record: <age> ago |
| Schema | <N>/100 | <count> violations |

## Critical Issues
- [COMPLETENESS] Field `email` is 23% null (expected <1%)
- [CONSISTENCY] Field `amount` has mixed types: int (89%), str (11%)

## Warnings
- [FRESHNESS] Newest record is 36 hours old

Next action: <recommendation>
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| JSONL validation needed | `[jsonl-validate]` for line-level error detail |
| Observability gaps found | `[observability-audit]` to check monitoring coverage |
