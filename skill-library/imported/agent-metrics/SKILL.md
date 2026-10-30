---
name: agent-metrics
description: Aggregate agent performance metrics from bus, git, and CI history
version: 0.1.0
execution-mode: advisory
argument-hint: "[agent-name] [--period N-days] [--trust]"
category: fleet-ops
status: candidate
---
# [agent-metrics]

## When to Use
- Reviewing agent trust levels before granting expanded scope
- Weekly multi-agent coordination review
- After an agent audit to quantify findings
- Debugging coordination issues between agents

## Execution

### 1. Bus Message Analysis
```bash
# Total messages per agent
awk -F'\t' '{print $2}' _state/coordination/messages.tsv 2>/dev/null | sort | uniq -c | sort -rn | head -10
# Message types per agent
awk -F'\t' '{print $2, $4}' _state/coordination/messages.tsv 2>/dev/null | sort | uniq -c | sort -rn | head -20
# Messages in last 7 days
awk -F'\t' -v cutoff="$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d)" \
  '$1 >= cutoff {print $2}' _state/coordination/messages.tsv 2>/dev/null | sort | uniq -c | sort -rn
```

### 2. Git Activity Per Agent
```bash
# Commits by agent (from branch names and commit messages)
git log --oneline --since="30 days ago" | grep -i "kimi\|gemini\|codex\|claude" | head -20
# Branches per agent
git branch -a | grep -i "kimi\|gemini\|codex" | head -10
# LOC by agent branches
for agent in kimi gemini codex; do
  echo "$agent branches:"
  git branch -a | grep -i "$agent" | head -5
done
```

### 3. Trust Score Calculation
Per-agent trust score (0-100) based on:
- **Scope compliance** (40%): % of commits within approved scope
- **Quality** (25%): test pass rate on agent's code
- **Cadence** (15%): commits within size limits
- **Communication** (10%): bus message protocol compliance
- **Reliability** (10%): task completion rate

### 4. Per-Agent Dashboard
If `$ARGUMENTS` specifies an agent name, show detailed view:
- All bus messages from that agent (last N days)
- All commits/branches
- Guardrail violations (from audit history)
- Current trust score with breakdown

## Output Format

```
Agent Metrics | <period> | <date>
============================================

Fleet Overview
--------------
  Agent          | Messages | Commits | Trust | Status
  ---------------|----------|---------|-------|----------
  claude-code    |    1,240 |     180 |  95   | ACTIVE
  kimi-1         |      340 |      45 |  72   | ACTIVE
  agent-c        |      180 |      12 |  38   | PROBATION
  codex          |       90 |      28 |  80   | ACTIVE

Bus Activity (last 7 days)
---------------------------
  claude-code:  42 messages (18 STATUS, 12 SITREP, 8 ACK, 4 DECISION)
  kimi-1:       15 messages (8 STATUS, 4 WIP_START, 3 COMPLETE)
  gemini:        3 messages (2 STATUS, 1 PROPOSAL)
  codex:         8 messages (5 ACK, 3 STATUS)

Trust Score Breakdown: gemini
-----------------------------
  Scope compliance:  20/40  (3 out-of-scope violations in 7 sessions)
  Quality:           22/25  (tests pass, but fabricated metrics)
  Cadence:           10/15  (1 oversized commit)
  Communication:      4/10  (identity violations)
  Reliability:        6/10  (2 reverted sessions)
  Total:             62/100 -> rounded to 38 (probation penalty applied)

Guardrail Violations (30 days)
------------------------------
  gemini:  7 violations (see [agent-audit] gemini for details)
  kimi-1:  0 violations
  codex:   0 violations

Next action: <recommendation>
```

## Skill Chains
- After `[agent-metrics]` with low trust -> `[agent-audit]` for detailed investigation
- After `[agent-metrics]` -> `[bus]` to review specific agent messages
- After `[agent-metrics]` -> `[dispatch]` informed by agent capabilities
