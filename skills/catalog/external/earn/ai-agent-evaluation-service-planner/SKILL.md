---
name: ai-agent-evaluation-service-planner
description: Scopes a paid AI-agent evaluation service with reproducible test cases, failure categories, and evidence-based client reporting.
version: 1.0.0
license: MIT
category: EARN
status: quarantined
source: CEOAI-authored
---

# AI Agent Evaluation Service Planner

## Purpose
Plan a bounded client service that evaluates an existing AI agent before release or renewal.

## Workflow
1. Record the agent's stated purpose, intended users, documented capabilities, and explicit exclusions.
2. Define task scenarios from client-approved examples and synthetic data; exclude secrets and personal data.
3. Create expected outcomes and scoring rules for correctness, completeness, instruction following, latency, and safe refusal.
4. Add adversarial and boundary cases: prompt injection, conflicting instructions, malformed inputs, unsupported claims, and tool misuse.
5. Distinguish observed evidence from evaluator judgment; preserve test inputs, outputs, versions, and timestamps supplied by the client.
6. Define severity levels and reproducibility requirements for each failure.
7. Prepare a report template with prioritized fixes and a retest plan; do not claim execution unless evidence is supplied.

## Output
Evaluation scope, scenario matrix, scoring rubric, risk taxonomy, evidence template, and client report outline.

## Safety and limits
- Do not access or operate the client's live agent without separate explicit authorization.
- Never submit sensitive data or secrets to a model.
- Do not fabricate test results, benchmark scores, or reliability claims.
- No paid APIs required; no runtime activation or tool grants.

## Provenance
CEOAI-authored workflow. Evaluation planning and reporting only.
