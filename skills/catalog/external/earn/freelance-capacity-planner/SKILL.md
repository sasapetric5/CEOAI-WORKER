---
name: freelance-capacity-planner
description: Estimates a freelancer's realistic available delivery capacity across active projects, deadlines, support commitments, and personal buffers.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# Freelance Capacity Planner

## Purpose
Help freelancers avoid overbooking and missed deadlines by planning from actual available hours and known commitments.

## Workflow
1. Collect the user's available work hours by week, existing commitments, holidays, recurring support, and fixed deadlines.
2. Separate committed work, tentative opportunities, admin time, and genuinely free capacity.
3. Estimate each task using user-provided effort ranges; preserve uncertainty instead of false precision.
4. Add explicit buffers for revisions, communication, context switching, and unexpected blockers.
5. Identify deadline collisions, overloaded weeks, and dependencies requiring client decisions.
6. Model a conservative plan and an optional stretch plan without presenting the stretch plan as guaranteed.
7. Recommend what to defer, renegotiate, or decline; prepare draft wording for the user's review.

## Output
Weekly capacity table, commitment map, risk flags, available hours range, deadline conflicts, and a draft renegotiation plan.

## Safety and limits
- Do not assume continuous availability or infer personal circumstances.
- Do not send messages, alter calendars, accept work, or make commitments.
- No paid scheduling APIs or third-party runtime dependencies.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Planning and draft-only.
