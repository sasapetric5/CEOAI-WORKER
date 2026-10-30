---
name: crucible-telemetry
description: Agent lifecycle metrics, guardrail violations, and fleet health.
version: 0.1.0
execution-mode: advisory
argument-hint: "[summary | agent AGENT_NAME | recent N]"
category: fleet-ops
status: candidate
---
# Crucible Telemetry — Agent Lifecycle Metrics

Measure agent maturation velocity, guardrail violation trends, and fleet health.

## When to Use
- "how are agents performing" or "agent health" or "crucible status"
- After guardrail violations (Gemini/Kimi scope breaches)
- Weekly review of multi-agent fleet
- Before promoting an agent to a higher trust level

## Data Sources

### 1. Crucible Events TSV (primary)
`state/telemetry/crucible-events.tsv` (canonical persistent store, mounted into container Tier 2) with fallback to `~/.claude/telemetry/crucible-events.tsv` — guardrail violations, scope blocks, hook failures.

Columns: `timestamp_utc`, `event_type`, `agent`, `detail`, `machine`, `session_id`

Event types: `GUARD_BLOCK`, `SCOPE_VIOLATION`, `HOOK_FAILURE`

### 2. Bus Messages (secondary)
`_state/coordination/messages.tsv` (or global bus via `bus-global.py`) — agent STATUS, SITREP, MILESTONE messages.

### 3. Guardrail Rules (reference)
`~/.agents/rules/gemini-guardrails.md`, `~/.agents/rules/_archived/kimi-guardrails.md`

## Analysis

### Violation Trends
```bash
TFILE="${FLEET_ROOT:-$HOME/.agents}/state/telemetry/crucible-events.tsv"
[ ! -f "$TFILE" ] && TFILE="$HOME/.claude/telemetry/crucible-events.tsv"

echo "=== Violations by Agent ==="
tail -n +2 "$TFILE" 2>/dev/null | cut -f3 | sort | uniq -c | sort -rn

echo "=== Violations by Type ==="
tail -n +2 "$TFILE" 2>/dev/null | cut -f2 | sort | uniq -c | sort -rn

echo "=== Violations by Day ==="
tail -n +2 "$TFILE" 2>/dev/null | cut -f1 | cut -dT -f1 | sort | uniq -c | sort

echo "=== Recent Violations (last 10) ==="
tail -n +2 "$TFILE" 2>/dev/null | tail -10

echo "=== Error Half-Life ==="
# Days between first violation of a type and last violation of same type
# (shorter = guardrails are working faster)
tail -n +2 "$TFILE" 2>/dev/null | sort -t$'\t' -k2,2 -k1,1 | \
  awk -F'\t' '{if (!first[$2]) first[$2]=$1; last[$2]=$1} END {for (t in first) print t, first[t], last[t]}'
```

### Bus Activity by Agent
```bash
BUS="$HOME/_state/coordination/messages.tsv"

echo "=== Agent Bus Activity (last 7 days) ==="
WEEK_AGO=$(date -u -d "7 days ago" +%Y-%m-%dT 2>/dev/null || date -u -v-7d +%Y-%m-%dT 2>/dev/null)
awk -F'\t' -v cutoff="$WEEK_AGO" '$1 >= cutoff' "$BUS" 2>/dev/null | cut -f2 | sort | uniq -c | sort -rn | head -15

echo "=== Message Types by Agent ==="
awk -F'\t' -v cutoff="$WEEK_AGO" '$1 >= cutoff {print $2, $4}' "$BUS" 2>/dev/null | sort | uniq -c | sort -rn | head -20

echo "=== Gemini Violation Audit (all time) ==="
grep -i gemini "$BUS" 2>/dev/null | grep -i "revert\|violation\|blocked\|reverted\|fabricat" | wc -l
echo "violations/reverts found in bus history"
```

### Fleet Maturity Assessment
```bash
echo "=== Current Agent Trust Levels ==="
echo "Agent          | Status     | Violations | Last Active"
echo "-------------- | ---------- | ---------- | -----------"

for AGENT in gemini kimi codex claude; do
  VIOLATIONS=$(tail -n +2 "$TFILE" 2>/dev/null | grep -i "$AGENT" | wc -l)
  LAST_BUS=$(grep -i "$AGENT" "$BUS" 2>/dev/null | tail -1 | cut -f1)

  case "$AGENT" in
    gemini) STATUS="PROBATION" ;;
    kimi)   STATUS="CONSTRAINED" ;;
    codex)  STATUS="ACTIVE" ;;
    claude) STATUS="TRUSTED" ;;
  esac

  printf "%-14s | %-10s | %-10s | %s\n" "$AGENT" "$STATUS" "$VIOLATIONS" "${LAST_BUS:-never}"
done
```

### Demotion Signals
```bash
echo "=== Demotion Candidates ==="
# Agents with >3 violations in last 7 days should be reviewed
WEEK_AGO=$(date -u -d "7 days ago" +%Y-%m-%dT 2>/dev/null || date -u -v-7d +%Y-%m-%dT 2>/dev/null)
tail -n +2 "$TFILE" 2>/dev/null | \
  awk -F'\t' -v cutoff="$WEEK_AGO" '$1 >= cutoff' | \
  cut -f3 | sort | uniq -c | sort -rn | \
  awk '$1 >= 3 {print "REVIEW: " $2 " (" $1 " violations in 7 days)"}'
```

## Output Format
```
Crucible Telemetry | <date>
════════════════════════════

## Fleet Status
| Agent | Trust Level | Violations (7d) | Bus Activity (7d) | Trend |
|-------|-------------|-----------------|--------------------|----|

## Violation Summary
- Total: N events
- By type: GUARD_BLOCK (N), SCOPE_VIOLATION (N), HOOK_FAILURE (N)
- Error half-life: N days (target: <3)

## Demotion Signals
- [agents needing review]

## Promotion Candidates
- [agents with clean records eligible for upgrade]

## Recommendations
- [actionable items]
```

## Skill Chains
| After completing... | Consider... |
|--------------------|-----------------------|
| `[crucible-telemetry]` | `[agent-audit] <agent>` (deep dive), `[rsi-dashboard]` (system-wide RSI health) |
| `[agent-audit]` | `[crucible-telemetry]` (fleet context) |
| `[rsi-dashboard]` | `[crucible-telemetry]` (agent layer of RSI) |

## Base120 Mapping
- **SY5** (Feedback Loops) — violation data feeds back into guardrail tightening
- **SY11** (Governance Patterns) — trust levels as governance tiers
- **DE12** (Constraint Isolation) — identify which constraint each agent fails on
- **IN2** (Inversion) — measure what goes wrong to define what "right" looks like
