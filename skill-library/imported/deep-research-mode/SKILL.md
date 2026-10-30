---
name: deep-research-mode
description: Wide-aperture research with evidence quality enforcement — source tiering, claim honesty, unknown-unknown hunting.
version: 0.1.0
execution-mode: advisory
status: approved
category: hummbl-research
protected_variable: source_integrity
composition:
  - synthesis-mode
  - red-team-mode
  - economics-mode
conflicts:
  - crisis-mode
---

# Deep-Research-Mode Skill

## Invocation

```
/deep-research-mode
```

Or "research this".

## What This Skill Does

Activates deep-research-mode for wide-aperture research. Enforces source
tiering (1-7), claim honesty (A/B/C), bias labeling, unknown-unknown hunting
(30% of time), and hypotheses-not-conclusions output.

## Inputs

- **Topic**: What to research?
- **Depth**: Quick scan (30min) / standard (2h) / deep (1 day+)
- **Scope**: What's in/out of scope?
- **Adjacent fields**: What related fields to explore for unknown-unknowns?

## Output

```markdown
# Research Report

**Date**: YYYY-MM-DD
**Topic**: <what was researched>
**Depth**: quick / standard / deep
**Time spent**: <duration>

## Landscape
- **Known**: <what is well-established>
- **Contested**: <what sources disagree on>
- **Unknown**: <what no source addresses>

## Sources
- [Tier 1] <source>: <claim> → [Claim A]
- [Tier 2] <source>: <claim> → [Claim B]
- [Tier 3] <source>: <claim> → [Claim C]
- [Tier 6] <source>: <claim> → [Claim C]

## Hypotheses
- H1: <hypothesis> (confidence: HIGH/MEDIUM/LOW)
- H2: <hypothesis> (confidence: HIGH/MEDIUM/LOW)
- H3: <hypothesis> (confidence: HIGH/MEDIUM/LOW)

## Contradictions
<where sources conflict — document both sides>

## Uncertainties
<what we don't know or can't know>

## Unknown-Unknowns Found
<things we discovered we didn't know to look for>

## Reproducibility
<can findings be reproduced? are sources stable?>

## Next Step
<proceed to synthesis-mode / more research needed / topic is exhausted>

## Receipt
<deep-research-mode receipt per doctrine template>
```

## Composition

- **deep-research-mode + synthesis-mode**: Research-then-decide pipeline.
- **deep-research-mode + red-team-mode**: Research-backed adversarial analysis.
- **deep-research-mode + economics-mode**: Investment research before allocation.

## Conflicts

- **deep-research-mode + crisis-mode**: Research demands slow exploration; crisis demands fast action. Use sequentially.

## Cost

~20K-80K tokens per session (depends on depth and number of sources).
