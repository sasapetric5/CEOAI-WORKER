---
name: doc-drift
description: Detect documentation drift — cross-reference canonical docs (AGENTS.md, rules-index.md, DOTFILE_MAP.md, TOPICS.md) against actual filesystem state. Surfaces stale claims, phantom references, and missing files.
version: 0.1.0
execution-mode: advisory
argument-hint: "[--full] [--quick] [--surface AGENTS|rules-index|DOTFILE_MAP|TOPICS|all] [--output json|table|bus]"
category: fleet-ops
status: candidate
providers:
  required: [python]
---

# doc-drift

Detect and report documentation drift — when canonical docs claim something about the fleet that is no longer true on disk.

## When to Use

- **Session start**: quick drift check before planning (pairs with `/sitrep`)
- **After any governance edit**: verify edits didn't introduce drift
- **Post-sync**: verify mesh-sync didn't break cross-references
- **Weekly review**: full drift scan as part of `/weekly-review`
- **Goal-loop**: one of the standard iters when no P1 work is available
- **Morning kickoff**: surface overnight drift

## What "drift" means

Documentation drift = a canonical doc says X, but the filesystem says Y. Examples:

- AGENTS.md says a task is "Disabled" but Task Scheduler shows it is "Ready" or "Running"
- rules-index.md lists a rule file that doesn't exist on disk
- DOTFILE_MAP.md says a path is a "junction" but it's a real directory (or vice versa)
- TOPICS.md references a memory pin that was archived or renamed
- Agent roster lists an agent file that was moved to `_archived/`

## Surfaces Checked

| Surface | Drift signals |
|---------|---------------|
| `AGENTS.md §1.2` | Scheduled Task claims vs actual Task Scheduler state |
| `AGENTS.md §1.1` | Canonical governance file paths vs actual file existence |
| `rules-index.md` | Listed rule files vs actual `rules/` directory contents |
| `DOTFILE_MAP.md` | Junction/sync-overlay/real claims vs actual directory link types |
| `TOPICS.md` | Referenced skill/rule/agent/memory files vs actual paths |
| `agent-roster.md` | Listed agent files vs actual `agents/` directory contents |

## How to run

```powershell
# Quick drift check (AGENTS.md + rules-index only)
python ~/.agents/skills/doc-drift/scripts/doc-drift-check.py --quick

# Full drift scan (all surfaces)
python ~/.agents/skills/doc-drift/scripts/doc-drift-check.py --full

# Check a specific surface
python ~/.agents/skills/doc-drift/scripts/doc-drift-check.py --surface rules-index

# Output as JSON (for bus posting)
python ~/.agents/skills/doc-drift/scripts/doc-drift-check.py --full --output json

# Dry run (no bus post)
python ~/.agents/skills/doc-drift/scripts/doc-drift-check.py --full --dry-run
```

## Output Format

```
Doc-Drift Scanner | 6 surfaces | <timestamp>
================================================

SURFACE: rules-index.md
  DRIFT: 2 phantom rules (listed but not on disk)
    - foo-bar.md (listed at L42, not found in rules/)
    - baz-qux.md (listed at L87, not found in rules/)
  OK: 88 rules verified

SURFACE: AGENTS.md §1.2
  DRIFT: 1 task status mismatch
    - FounderMode-SpokeHeartbeat: doc says "Disabled", Task Scheduler says "Ready"
  OK: 5 other tasks match

SUMMARY
  surfaces_checked: 6
  drift_found: 3
  phantoms: 2
  status_mismatches: 1
  ok: 152
```

## Drift Categories

| Category | Severity | Example |
|----------|----------|---------|
| **phantom** | P1 | Doc references file that doesn't exist |
| **status_mismatch** | P1 | Doc says "disabled", actual state is "running" |
| **type_mismatch** | P2 | Doc says "junction", actual is "real directory" |
| **stale_date** | P3 | Doc says "last updated 2026-04-01" but file was modified 2026-06-13 |
| **count_mismatch** | P3 | Doc says "30+ rules" but directory has 92 |

## Integration with Goal-Loop

When invoked inside a goal-loop iter, this skill operates in **analysis lane** (not review). Findings go to bus as STATUS with `type=drift-report`. No code changes — read-only scan.

## Standing Watch

Some drift findings are长期 watch items (not immediately fixable). These are tracked in the `drift-watch` section of MEMORY.md and re-checked on each scan.

## Rules

- **Read-only**. Never modifies documentation or filesystem state.
- **Receipt-required**. Every scan posts a bus receipt (STATUS type) unless `--dry-run`.
- **Idempotent**. Running twice produces the same result.
- **No false alarms on intentional divergence**. If a doc explicitly says "this is deliberately different", that's not drift — it's documented divergence. The scanner checks for `<!-- drift-ignore -->` comments.
