# CEOAI specialist agents, orchestration and MCP resources

## Specialist profiles
The first five curated profiles are in `src/agent/builtin-agents.mjs`:
- Cloudflare platform engineer
- Quality and test engineer
- Application security reviewer
- Crawler and Queue reliability engineer
- Knowledge and retrieval engineer

Profiles describe role, skill references and candidate tool IDs. They do not grant permissions by themselves. The registry validates every referenced skill and tool against the active registries.

## Multi-agent supervisor
`createMultiAgentSupervisor()` ranks specialists for a task, selects up to three by default and runs them sequentially. Sequential execution is intentional: it avoids uncontrolled fan-out and makes resource use predictable.

Every run requires explicit `allowToolExecution: true`, a planner adapter, and the caller's allowlist. Effective tools are the intersection of:
1. Agent profile's approved tool IDs
2. Selected skill's approved tool IDs
3. Caller-provided allowed tool IDs

One opaque agent budget is shared across the entire run. Per-agent loops retain their own step and tool-session limits. Results preserve partial failures; optional synthesis receives only bounded successful outputs and failure codes.

The module does not call an LLM itself. The application supplies `planAgent` and optional `synthesize` adapters. No production chat route is redirected automatically.

## Composition using existing KV_MEMORY
```js
import { createAgentLoop } from "./agent-loop.mjs";
import { createKVAgentSystem } from "./agent-system.mjs";

const system = await createKVAgentSystem({
  kv: env.KV_MEMORY,
  toolRegistry,
  capabilityPolicy: {},
  agentLoopFactory: ({ toolRegistry, skillRegistry }) =>
    createAgentLoop({ toolRegistry, skillRegistry }),
});

const prepared = await system.multiAgentSupervisor.prepare({
  task: "review a Queue consumer for duplicate processing",
});
```

## Read-only MCP resource adapter
`createSkillMCPResources()` implements only `resources/list` and `resources/read`. It exposes metadata and selected Markdown content using `ceoai://skills/<skill_id>` resource URIs. Every request calls the required authorization callback. There are no MCP tools, writes, public default, or HTTP route in this change.

To enable it through `createKVAgentSystem()`, provide an application-owned `mcpAuthorize(authContext, { method })` callback. Without that callback, `system.mcpResources` is `null`.


## Signed capability approvals and durable tool execution

When a reviewed tool is eventually registered and enabled, the production supervisor uses the four required grant layers: app, caller, agent, and skill. All four must grant the same tool capability, operation, and resource. Resource scopes are exact by default; descendant access requires an explicit boundary-aware `/*` scope.

Approval-required calls use Ed25519 V2. The Worker stores only `CAPABILITY_APPROVAL_PUBLIC_KEY`; the owner keeps the private key offline. The signed payload binds the app, caller, agent, skill, tool, operation, resource, canonical argument digest, stable effect key, and short expiry. The effect key is the same stable key used by the tool executor. The approval ID is read only from the verified signed payload.

`CapabilityAuthorityDO` atomically consumes a single-use approval, increments the durable capability quota, and records the effect receipt. Repeating the same effect key and identical claims replays the authorization receipt; rebinding that key to different claims is denied. `WorkflowTaskDO` and the idempotent executor use leases, fencing tokens, checkpoint revisions, and an effect ledger. An uncertain external outcome pauses for reconciliation and is never blindly repeated.

The supervisor-to-tool integration is covered by `test/signed-approval-supervisor-integration.test.mjs`, including a real `CapabilityAuthorityDO` test harness and a durable idempotent tool executor. This is deterministic CI coverage, not a live Cloudflare production test.

## Current activation gate

The authenticated app gateway still constructs `tools: []` with `enabled: false` and supplies an empty tool allowlist. This is deliberate. The signed approval and durable execution path is tested as an isolated integration, but no app-facing external-action tool is active. Before enabling one, add and review its strict input schema, handler, downstream idempotency contract, four signed grant layers, and an approval request/confirmation flow that can bind the exact planned call before execution. The app-level caller principal is currently derived from the authenticated HMAC app identity; it is not a distinct end-user identity.

## Limits and security
- Maximum three agents by default; hard limit five.
- Sequential execution, shared budget, bounded context and existing per-agent step/tool limits.
- Skill text remains untrusted reference material.
- MCP access is read-only and authorized on every request.
- No new paid service, binding, database, or production endpoint.

## Existing provider integration
The internal `runCEOAIInternalAgentTask()` entry point connects the supervisor to the existing V5 provider pool. It reuses configured credentials, model selection, intent ranking, KV cooldown and quota-aware failover; no new provider, key, binding or paid service is introduced.

The provider planner in `src/agent/provider-agent-planner.mjs` requests strict JSON decisions, validates tool IDs against the loop's approved tool list, treats skill text as untrusted reference material, and rejects malformed or oversized outputs. The runtime in `src/agent/provider-agent-runtime.mjs` creates a fresh planner per task and shares one model-call budget across specialist turns and optional synthesis.

The integration is internal-only. No new HTTP route is registered and the existing `/api/chat` handler is not redirected. Calls require `AI_ENABLED=true`, the existing `KV_MEMORY` binding and explicit `allowToolExecution: true`. Tool IDs default to an empty allowlist. AI model-call limits and tool-call limits are separate and bounded.

## HMAC application agent gateway
The Worker exposes a separate `POST /v1/agents/run` route for `CONTENTCRAFT-APP`, `AIFORCE-APP`, and `RANKGEO-APP`. It authenticates the exact request body and path with the existing HMAC verifier and mandatory SecurityOrchestratorDO nonce store. It also requires the existing RATE_LIMITER binding and fails closed if that binding is unavailable.

Per-app bounds: ContentCraft may select at most two agents and use at most three model calls per task; AI Force may select at most three agents and use at most four model calls. Request body is limited to 8 KiB, task text to 2,000 characters and JSON input to 4 KiB. Only `task`, `input`, `limit`, `conversation_id`, `request_id`, and a bounded `approvals` array are accepted. Approval tokens must be structurally valid Ed25519 V2 tokens; malformed or duplicate tokens are rejected before model invocation.

The gateway creates an empty, disabled agent tool registry, so agents cannot initiate external actions. Separately, explicit crawl requests may be routed to the existing Spider queue only when the authenticated app policy permits it and the operator sets `SPIDER_AGENT_ROUTING_ENABLED=true`; this operation is asynchronous and returns a job ID. HMAC app identity does not itself grant tool capabilities. Data-source selection and Spider result handling are documented in [RESEARCH-AND-CRAWLER.md](./RESEARCH-AND-CRAWLER.md).

Agent provider routing applies a separate strict free-tier gate: OpenRouter requires an explicitly confirmed `:free` model; Gemini requires explicit free confirmation and free-only mode; Workers AI and GLM Flash require their own explicit free-confirmation flags. Configured credentials alone do not qualify a provider. If no provider passes this gate, the request returns a controlled unavailable response.

This route is separate from `/v1/chat/completions` and `/api/chat`. No existing chat route behavior is changed. The new route is not production-deployed by this change.
