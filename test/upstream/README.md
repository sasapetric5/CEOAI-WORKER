# CEOAI Upstream Reuse Registry

This registry tracks proven upstream behaviors that CEOAI may adapt. It is not a list of tests that have already passed.

## Rules

- Pin every source to an immutable 40-character commit.
- Verify the repository license before copying any code or test.
- Prefer porting behavioral assertions into CEOAI's Node.js/Workers test environment over importing another runtime.
- Never import paid API requirements, secrets, telemetry, or network-dependent test fixtures into the free-only verification suite.
- A source counts as successful only after its adapted test is executed in CEOAI CI and evidence is recorded.
- Keep restricted or unclear sources quarantined. Dify's modified Apache license has additional commercial/multi-tenant conditions; no Dify code or tests are copied into CEOAI under this registry entry.
- CrewAI's delegation behavior is tracked, but no test is eligible for adaptation until an exact upstream test path is pinned.

## Current implementation order

1. LangGraph: checkpoint, interrupt, resume and async scheduling invariants.
2. Cloudflare Agents: Durable Object eviction and checkpoint recovery.
3. OpenAI Agents SDK: deterministic handoff and tool routing.
4. CrewAI: delegation and shared-context tests after source-path pinning.
5. Dify: reference-only pending license review.

## Status meanings

- `candidate`: identified but not yet cleared for adaptation.
- `license_verified`: source and license pinned; compatibility review remains.
- `compatibility_reviewed`: behavior is suitable for CEOAI's runtime.
- `adapted`: CEOAI test implementation exists but has not passed yet.
- `executed_pass`: adapted test ran successfully and has recorded evidence.
- `executed_fail`: adapted test ran and failed.
- `quarantined`: do not copy or adapt until the blocking issue is resolved.
