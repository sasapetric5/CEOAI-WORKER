# CEOAI Durable Execution v1.1

## Execution lifecycle

1. The engine obtains a cryptographically random owner token and acquires a per-task Durable Object lease.
2. The Durable Object assigns a monotonically increasing fencing token.
3. Every checkpoint write uses owner token + fencing token + revision compare-and-swap.
4. Before each step, the engine claims a persistent idempotency-ledger entry using a SHA-256 hash of the canonical JSON input.
5. A completed ledger entry is replayed without executing the step again.
6. A running ledger entry with an uncertain outcome pauses the task for reconciliation.
7. During long steps, the engine renews its lease and passes an AbortSignal to the executor. The executor should stop promptly when aborted.
8. The engine completes the ledger entry before writing the next checkpoint, so a checkpoint failure can safely replay the recorded result.

## Critical external-effect contract

The ledger prevents duplicate execution inside CEOAI and supports safe recovery after a checkpoint failure. It cannot guarantee exactly-once behavior for an arbitrary remote side effect if the remote service does not support idempotency or outcome lookup.

Every executor that performs an external mutation MUST forward the supplied `idempotencyKey` to the downstream service when supported. If the call outcome is uncertain, the engine pauses in `paused_reconciliation`; it does not retry the effect automatically.

## Approval and cancellation

Approval decisions are checkpointed under a fresh lease. Cancellation is also fenced. A task with an unresolved external effect cannot be cancelled through the ordinary cancellation path; reconciliation must happen first.

## Production wiring

Use `createCloudflareDurableExecutionEngine({ env, executeStep })` from `cloudflare-durable-runtime.mjs`. It requires `env.WORKFLOW_TASKS` and deliberately has no in-memory fallback. The returned engine is a runtime factory, not a public HTTP route; callers must supply a trusted, capability-checked step executor.

## Operational status

The code and deterministic Node tests are committed on `main`. GitHub Actions/Workers runtime verification is still required before enabling this in production. Do not count tests as passing until CI actually executes them.
