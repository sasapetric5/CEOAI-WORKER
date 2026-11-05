---
name: ai-automation-feasibility-estimator
description: Evaluates whether a proposed AI automation is feasible, safe, measurable, and economically sensible using explicit user-provided assumptions.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# AI Automation Feasibility Estimator

## Purpose
Help a freelancer assess an AI automation project before quoting it. It highlights integration, data, reliability, review, and ongoing-maintenance costs that are easy to overlook.

## Workflow
1. Collect the workflow specification, required systems, data types, expected volume, latency needs, and client acceptance criteria.
2. Separate confirmed capabilities from assumptions; mark undocumented APIs, permissions, quotas, and pricing UNKNOWN.
3. Assess each step for deterministic automation, AI-assisted classification/generation, or mandatory human decision.
4. Identify failure modes: malformed input, model uncertainty, timeouts, provider outages, duplicate actions, rate limits, privacy exposure, and rollback.
5. List security and compliance questions, including data minimization, retention, access isolation, auditability, and human approval.
6. Estimate build, testing, integration, monitoring, support, and maintenance effort as ranges based on supplied analogs or explicit assumptions.
7. Compare expected benefit using client-provided volume and time measurements only. Show arithmetic and scenario ranges; never invent savings.
8. Recommend BUILD A SMALL PILOT, RE-SCOPE, or DO NOT AUTOMATE, with reasons and unresolved dependencies.

## Output
Feasibility decision, assumptions register, dependency and risk matrix, effort range, measurement plan, operating-cost unknowns, pilot scope, and quote inputs.

## Safety and limits
- Do not connect systems, execute workflows, process live customer data, or change production.
- Do not assume a provider's free tier, API availability, or commercial reuse rights; verify official terms separately.
- Never treat AI output as authoritative where human review is required.
- No paid tools or APIs are required by this skill.
- No runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Analysis and planning only.
