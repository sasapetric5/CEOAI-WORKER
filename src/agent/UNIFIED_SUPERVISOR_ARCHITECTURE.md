# CEOAI Unified Supervisor Architecture

Status: architecture contract for incremental implementation. This document does not claim every layer is already wired or production-enabled.

## North star

One CEOAI Supervisor, one bounded agent execution runtime, one durable task lifecycle, and four authoritative registries. The five upstream projects contribute proven patterns; they are not deployed as five independent runtimes.

## Upstream responsibility map

| Upstream project | Pattern to adopt | CEOAI destination |
| --- | --- | --- |
| LangGraph | Explicit graph state, deterministic branching, checkpoint/resume, interrupt and recovery | Advanced Orchestrator + Durable Execution Engine |
| OpenAI Agents SDK | Bounded agent loop, tools, handoff, guardrails, tracing and lifecycle | Agent Loop + Tool Registry + Supervisor policies |
| CrewAI | Specialist teams, delegation, shared task context, sequential/parallel coordination | Multi-Agent Supervisor + Agent Registry |
| Dify | Workflow composition, versioned flows, knowledge/RAG retrieval and app-facing workflows | Workflow/Knowledge layer, with license-safe independent implementations |
| Cloudflare Agents | Durable Objects, persistent state, queues, alarms, concurrency and recovery | WorkflowTaskDO + KV + Queue + checkpoint adapter |

Adopt behavior and tests, not unnecessary runtime dependencies. Pin upstream source commits and preserve attribution/license notices when source code is reused. Dify stays quarantined until its additional license conditions are cleared; generic workflow concepts may be independently implemented.

## Four authoritative registries

### 1. Skill Registry

Owns approved executable skill definitions:
- immutable skill ID and semantic version;
- category: SEO, EARN, CODING, RESEARCH, GENERAL;
- description, tags, keywords and source provenance;
- content digest, license/provenance and security-review status;
- declared tool requirements and input/output contract;
- compatibility with approved apps and capability policy.

A skill is discoverable only when approved. A catalogue entry is not proof that it is safe or executable. Dynamic KV loading must verify the stored digest and current approval state.

### 2. Agent Registry

Owns specialist agent profiles:
- immutable agent ID and version;
- role, task domain and selection keywords;
- approved skill references;
- declared tool requirements, handoff contract and bounded budget;
- app compatibility and lifecycle state.

Agents do not grant themselves permissions. The Supervisor selects specialists, but execution permissions come from the Capability Registry.

### 3. Capability Registry

The authority for what a caller, app, agent, skill or tool may do:
- principal and app scope;
- capability ID, resource scope and allowed operation;
- constraints, quotas, budget and expiry;
- approval requirements and policy version;
- explicit deny rules and audit requirements.

Permissions are intersected, never unioned: caller/app grants ∩ agent declaration ∩ skill declaration ∩ tool policy. A missing grant means deny. Wallet connection is not transaction authority; every signing, payout or transfer needs a separate approval and security check. External mutations must use the approval and idempotency contracts.

### 4. Test Registry

The evidence ledger for every upstream pattern, imported/adapted test, skill, agent, capability policy and integration:
- stable test ID, category, source project/repository/path;
- pinned upstream commit, license decision and attribution;
- CEOAI adapter/path and environment;
- exact command, fixtures and deterministic/network/secret requirements;
- result, timestamp, tested commit SHA, runtime/version and CI run URL;
- failure classification, quarantine reason and regression links.

Allowed lifecycle: candidate → license_verified → compatibility_reviewed → adapted → executed_pass / executed_fail; quarantine is a separate blocked state. Only executed_pass with evidence tied to a commit counts as passing. Test definitions, skipped tests, mocks and unexecuted upstream tests never count as successful tests.

The existing `test/upstream/registry.json` remains the upstream-source/adaptation manifest. A separate `src/agent/test-registry.mjs` now defines the evidence ledger: records are append-only, and executed_pass requires a trusted CI evidence verifier plus commit/run/command/runtime/exit evidence. A production atomic storage adapter and trusted GitHub Actions evidence ingestion are still required.

## Unified execution path

1. Resolve app identity and caller intent.
2. Supervisor selects approved agent(s) and approved skill(s) from their registries.
3. Capability Registry computes the least-privilege intersection and explicit approval gates.
4. Workflow compiler builds a canonical DAG; dependencies and branch decisions are validated.
5. Durable Execution Engine acquires a lease and monotonically increasing fencing token.
6. Each step claims its durable idempotency record before execution; the step receives a stable idempotency key and abort signal.
7. Checkpoints and ledger writes are fenced and revision-checked. Uncertain external effects pause for reconciliation; they are never blindly retried.
8. Handoffs/delegation pass only bounded, sanitized context and the remaining shared budgets.
9. Outputs are validated, audited and returned to the requesting app.
10. Test Registry records execution evidence and regressions against the exact commit.

## Required invariants

- One main branch is the integration source of truth.
- One CEOAI Worker execution system; specialist agents are modules, not separate unsupervised runtimes.
- Reliability first, then latency, then additional capabilities.
- No paid API, paid infrastructure or real external mutation in deterministic tests.
- No agent/skill can elevate its own capabilities.
- No external side effect without an explicit capability and required user approval.
- No duplicate external operation by blind retry. Exactly-once remote effects require downstream idempotency or outcome reconciliation.
- Durable checkpoints, Queue/DO recovery, and provider routing remain intact.
- All imported/adapted behavior is version-pinned, license-reviewed and evidence-backed.
- Production activation only after local/CI and Workers-runtime checks pass.

## Current implementation map and honest gaps

Already present in the repository:
- Skill Registry and KV Skill Registry/storage.
- Agent Registry and Multi-Agent Supervisor.
- Agent Loop and Tool Registry.
- Advanced DAG Orchestrator.
- Durable Execution Engine with lease/fencing/idempotency integration.
- WorkflowTaskDO and Cloudflare checkpoint/runtime adapter.
- Upstream source manifest at `test/upstream/registry.json`.

Still required before claiming the target architecture is complete:
1. A first-class Capability Registry (currently capability policy is distributed across skill storage, tool declarations and caller inputs).
2. A first-class Test Registry that records executed evidence, distinct from the upstream source manifest.
3. Supervisor composition that uses the canonical DAG and durable engine as one runtime path, not parallel standalone modules.
4. Trusted persisted DAG checkpoint restore; caller-supplied prior results must never be treated as proof of completed nodes.
5. Handoff, tracing and guardrail integration with bounded shared budgets and app-specific permissions.
6. Workers/Vitest integration tests and green CI for the complete runtime.

## Delivery order

A. Finish and verify Durable Execution ↔ Lease/Fencing/Idempotency integration.
B. Add Capability Registry and policy-intersection tests.
C. Add authoritative Test Registry and CI evidence ingestion.
D. Connect Supervisor → Agent Registry/Skill Registry → canonical DAG → Durable Execution.
E. Add handoff/delegation/tracing/guardrails.
F. Add workflow knowledge/RAG with source attribution and data-isolation tests.
G. Expand upstream-derived tests and approved skills in measured batches.

Do not skip a gate or mark an item complete based only on source code existing.
