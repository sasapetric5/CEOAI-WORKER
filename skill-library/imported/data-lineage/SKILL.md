---
name: data-lineage
description: Trace data lineage from source through transforms to sink for impact analysis and compliance
version: 0.1.0
execution-mode: advisory
argument-hint: "<pipeline-or-table> [--direction upstream|downstream|both] [--depth 5]"
category: governance-compliance
status: candidate
---
# data-lineage | Data Lineage Tracer

## When to Use
- Performing impact analysis before schema or pipeline changes
- Auditing data flow for compliance (GDPR, CCPA, HIPAA)
- Debugging unexpected values in a downstream table
- Documenting transform chains for onboarding and reviews

## Execution

### 1. Parse Target
- `$ARGUMENTS`: `<pipeline-or-table>` identifier (e.g. `etl.daily_load` or `warehouse.facts.orders`)
- `--direction upstream|downstream|both`: trace direction (default both)
- `--depth N`: maximum graph depth to traverse (default 5)

### 2. Identify Nodes
- Resolve the target to a concrete dataset or pipeline stage
- Enumerate direct dependencies (sources consumed, sinks produced)
- Record transform type: sql, python, spark, airflow task, dbt model

### 3. Build Dependency Graph
- Traverse in the requested direction up to `--depth`
- For each node: record name, type, transform, and parent/child edges
- Detect cycles and flag them for manual review
- Capture column-level lineage where transforms are parseable

### 4. Annotate for Impact Analysis
- Mark nodes with break-glass risk (critical dashboards, ML features)
- Estimate blast radius: count downstream consumers
- Flag orphaned nodes with no upstream source

### 5. Emit Graph
- Serialize graph as JSON (nodes + edges) or DOT for visualization
- Write to `_state/lineage/<target>.json` and `.dot`

## Output Format

```
data-lineage | <target> (direction=both, depth=5)

## Graph Summary
- Nodes: 12 | Edges: 18 | Cycles: 0 | Max depth reached: 4
- Upstream sources: 3 | Downstream sinks: 5

## Lineage (upstream)
raw.events -> staging.events_clean -> mart.facts.orders

## Lineage (downstream)
mart.facts.orders -> dashboard.revenue -> report.board_pack
mart.facts.orders -> ml.churn_features

## Impact Analysis
| Node                 | Type   | Consumers | Risk     |
|----------------------|--------|-----------|----------|
| mart.facts.orders    | table  | 7         | critical |
| dashboard.revenue    | bi     | 2         | high     |

## Verdict
PASS | 12 nodes traced, blast radius = 7 consumers
```

## Skill Chains
- After tracing -> `[pipeline-lineage-map]` to visualize the full graph
- After tracing -> `[data-catalog]` to persist lineage links
- Before tracing -> `[data-govern]` to scope compliance requirements
- Before tracing -> `[etl-design]` to review transform definitions
