# CEOAI Skill Registry and Supervisor

## Runtime model
CEOAI separates discovery from loading. The registry indexes metadata only (ID, version, description, tags, keywords, provenance and code-owned capability policy). Search returns bounded metadata; full skill text is loaded only after selection. The supervisor selects no more than three skills by default and passes them to the planner as untrusted reference material.

## Existing infrastructure
The scalable catalog uses the existing `KV_MEMORY` binding. It does not require D1, Vectorize, R2, Containers, or a paid service.
- Index: `skills:v1:index`
- Immutable document: `skills:v1:doc:<id>:<version>:<sha256>`
- Maximum: 10,000 indexed skills, 4 MiB index, 24 KiB per document
- Documents are written before the index pointer; the index is published last.
- Every document is SHA-256 checked when loaded.

`publishSkillCatalogToKV()` is an import/admin function, not an HTTP endpoint and not called automatically. Invoke it only from an authenticated and approved intake workflow. `createKVSkillRegistry()` reads metadata once and retrieves only selected documents.

## Security
Catalog metadata cannot grant tool permissions. KV registry capabilities are empty by default and can be assigned only through the code-owned `capabilityPolicy`. The existing agent loop continues to intersect those capabilities with the caller allowlist, require `allowToolExecution: true`, and enforce tool schemas, timeouts and budgets.

Skill text is untrusted guidance. It is never evaluated, imported as JavaScript, sent to a shell, or allowed to change policy. The planner receives `instructionTrust: "untrusted_reference_only"`.

## Composition
```js
import { createAgentLoop } from "./agent-loop.mjs";
import { createKVSkillSystem } from "./skill-system.mjs";

const system = await createKVSkillSystem({
  kv: env.KV_MEMORY,
  toolRegistry,
  agentLoopFactory: ({ toolRegistry, skillRegistry }) =>
    createAgentLoop({ toolRegistry, skillRegistry }),
  maxSelectedSkills: 3,
  capabilityPolicy: {},
});

const result = await system.supervisor.run({
  task: "review a Cloudflare Queue consumer for duplicate processing",
  input: { taskId: "bounded-input" },
  allowToolExecution: false,
  allowedToolIds: [],
  plan: async (context) => {
    // Connect the application's approved model/planner adapter here.
    return { type: "final", output: context.selectedSkills.map((s) => s.id) };
  },
});
```

This is a deterministic discovery/loading and orchestration layer, not an LLM or autonomous executor. The application must supply the planner callback. The current public chat endpoint is not silently rerouted by this module.
