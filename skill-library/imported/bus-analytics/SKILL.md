---
name: bus-analytics
description: Analyze coordination bus message patterns, frequency, and agent activity.
version: 0.2.0
execution-mode: advisory
argument-hint: "[senders | types | volume | agent AGENT_NAME]"
category: fleet-ops
status: candidate
---
## Context Gathering

Before executing this skill, gather the following context:
- **Bus entries**: Run `wc -l < _state/coordination/messages.tsv 2>/dev/null || echo "0"`
- **Active agents (last 20 msgs)**: Run `tail -20 _state/coordination/messages.tsv 2>/dev/null | cut -f2 | sort -u | tr '\n' ', ' || echo "none"`

# Bus Analytics Command

Analyze message patterns on the coordination bus.

## Usage

```bash
[bus-analytics]        # Full analytics report
```

## Execution

### 1. Message count by agent
```bash
tail -200 _state/coordination/messages.tsv | cut -f2 | sort | uniq -c | sort -rn
```

### 2. Message type distribution
```bash
tail -200 _state/coordination/messages.tsv | cut -f4 | sort | uniq -c | sort -rn
```

### 3. Activity timeline (messages per hour, last 24h)
```bash
tail -200 _state/coordination/messages.tsv | cut -f1 | cut -dT -f1,2 | cut -d: -f1 | sort | uniq -c
```

### 4. BLOCKED message analysis
```bash
grep "BLOCKED" _state/coordination/messages.tsv | tail -10
```

### 5. Agent-to-agent communication patterns
```bash
tail -200 _state/coordination/messages.tsv | cut -f2,3 | sort | uniq -c | sort -rn
```

### 6. Request acceptance and resolution

Use the canonical live reader when the documented local TSV is absent or stale.
Run `python scripts/bus-requests.py --count 5000` for outstanding requests, or
`python scripts/bus-requests.py --bus snapshot.tsv --json --all` for a snapshot.

Report the coverage window and cached/invalid-row diagnostics. A missing response
means no correlated response was observed in that window, not proof that no work
happened. Leading WIP declarations inside STATUS count; quoted mentions do not.
Conflicting host/machine fields are reported, never silently reassigned. See
`docs/operations/bus-request-tracking.md` for request fields and response examples.

## Output Format

```
Bus Analytics | <YYYY-MM-DD HH:MMZ>
════════════════════════════════════

Total entries: NNN
Analysis window: last 200 messages

## Agent Activity
| Agent | Messages | Last Active |
|-------|----------|-------------|
| claude-code | 45 | 2m ago |
| kimi-1 | 23 | 1h ago |
| ... | ... | ... |

## Message Types
| Type | Count | % |
|------|-------|---|
| SITREP | 30 | 40% |
| STATUS | 20 | 27% |
| BLOCKED | 5 | 7% |
| ... | ... | ... |

## Activity Timeline (Last 24h)
<hour-by-hour activity bars or counts>

## Communication Patterns
| From → To | Count |
|-----------|-------|
| claude-code → all | 35 |
| kimi-1 → claude-code | 12 |

## Anomalies
<gaps > 4h, burst patterns, unanswered BLOCKED messages>
```

## Constraints

- READ-ONLY. Do not modify the bus.
- Use `cut`, `sort`, `uniq` on the TSV -- do not parse with Python unless necessary.
- Report actual data, do not fabricate patterns.
