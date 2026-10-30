---
name: agent-audit
description: Audit a specific agent's bus activity, commit history, trust score, and guardrail compliance.
version: 0.2.0
execution-mode: advisory
argument-hint: "\"AGENT_NAME\" (e.g., gemini, codex, kimi-1)"
authority: operator
category: governance-compliance
status: candidate
---
# Agent Audit Command

Deep-dive audit of a specific agent's behavior, trust, and compliance.

## Execution

Given `$ARGUMENTS` as the agent name, run ALL of these in parallel:

### 1. Bus Activity
```bash
grep -i "$AGENT" _state/coordination/messages.tsv | tail -20 | column -t -s $'\t'
grep -i "$AGENT" _state/coordination/messages.tsv | awk -F'\t' '{print $4}' | sort | uniq -c | sort -rn
grep -i "$AGENT" _state/coordination/messages.tsv | wc -l
```

### 2. Commit History
```bash
git log --all --author="$AGENT" --oneline -20 2>/dev/null
git log --all --oneline -100 | grep -i "$AGENT" | head -20
```

### 3. Guardrail Check
- Read the agent's guardrails file if it exists:
  - `~/.agents/rules/gemini-guardrails.md`
  - `~/.agents/rules/_archived/kimi-guardrails.md`
- Check approved identities, approved scope, blocked scope
- Verify recent bus messages use approved identity
- Check for prohibited message types (DECISION, DIRECTIVE)

### 4. Trust Assessment
- Count bus messages (volume)
- Check for BLOCKED messages from this agent
- Check for ERROR messages mentioning this agent
- Look for audit findings or revert commits referencing this agent
- Check AGENTS.md for current status (active/probation/retired)

## Output Format

```
Agent Audit | <agent-name>
════════════════════════════════

Status: [ACTIVE | PROBATION | RETIRED]
Bus messages: N (last 30 days)
Commits: N (last 30 days)
Guardrail violations: N

## Bus Activity Summary
<type distribution table>

## Recent Activity
<last 10 bus messages>

## Guardrail Compliance
<approved vs actual scope>
<identity check>
<prohibited actions check>

## Trust Score
<assessment with evidence>

## Recommendations
<keep/restrict/escalate>
```

## Known Agents
- `codex` -- trusted engineering and critical-review peer; no standing primary authority
- `devin` -- supervised delegated runtime; ACTIVE-AIP/PROBATIONARY until the
  canonical roster says otherwise
- `claude-code` -- on-demand, quota-constrained specialist; never assume it is
  the primary/default auditor
- `agy` -- on-demand Google AI Pro GitOps specialist; distinct from `gemini`
- `gemini` -- separate probationary research identity
- System agents as configured in your agent registry

## Skill Chains
- For delegation history complements bus and commit data -> `[cross-runtime-bridge]` (`python ~/bin/cross_runtime_bridge.py sessions`)
