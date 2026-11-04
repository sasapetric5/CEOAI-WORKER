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
The Worker exposes a separate `POST /v1/agents/run` route for `CONTENTCRAFT-APP` and `AIFORCE-APP`. It authenticates the exact request body and path with the existing HMAC verifier and mandatory SecurityOrchestratorDO nonce store. It also requires the existing RATE_LIMITER binding and fails closed if that binding is unavailable.

Per-app bounds: ContentCraft may select at most two agents and use at most three model calls per task; AI Force may select at most three agents and use at most four model calls. Request body is limited to 8 KiB, task text to 2,000 characters and JSON input to 4 KiB. Only `task`, `input`, and `limit` are accepted.

The gateway creates an empty, disabled tool registry. Therefore this first app integration is analysis/response only: no crawling, external requests, writes, publishing or other side effects. HMAC app identity does not itself grant tool capabilities.

Agent provider routing applies a separate strict free-tier gate: OpenRouter requires an explicitly confirmed `:free` model; Gemini requires explicit free confirmation and free-only mode; Workers AI and GLM Flash require their own explicit free-confirmation flags. Configured credentials alone do not qualify a provider. If no provider passes this gate, the request returns a controlled unavailable response.

This route is separate from `/v1/chat/completions` and `/api/chat`. No existing chat route behavior is changed. The new route is not production-deployed by this change.
