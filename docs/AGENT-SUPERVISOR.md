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
